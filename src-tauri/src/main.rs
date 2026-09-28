// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use tauri::{
    Emitter, Manager,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_global_shortcut::ShortcutState;

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);
static PREV_WINDOW: AtomicIsize = AtomicIsize::new(0);

/* ---- Win32 FFI：前台窗口记录 / 切换、模拟按键、ShellExecute ---- */
#[cfg(windows)]
mod win32 {
    use std::os::windows::ffi::OsStrExt;

    pub fn to_wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    #[link(name = "user32")]
    extern "system" {
        pub fn GetForegroundWindow() -> isize;
        pub fn SetForegroundWindow(h: isize) -> i32;
        pub fn IsWindow(h: isize) -> i32;
        pub fn GetWindowThreadProcessId(h: isize, pid: *mut u32) -> u32;
        pub fn AttachThreadInput(id1: u32, id2: u32, attach: i32) -> i32;
        pub fn keybd_event(bvk: u8, bscan: u8, dwflags: u32, dwextrainfo: usize);
    }
    #[link(name = "kernel32")]
    extern "system" {
        pub fn GetCurrentThreadId() -> u32;
    }
    #[link(name = "shell32")]
    extern "system" {
        pub fn ShellExecuteW(
            hwnd: isize,
            verb: *const u16,
            file: *const u16,
            params: *const u16,
            dir: *const u16,
            show: i32,
        ) -> isize;
    }

    pub const VK_CONTROL: u8 = 0x11;
    pub const VK_V: u8 = 0x56;
    pub const KEYEVENTF_KEYUP: u32 = 0x0002;
}

fn show_main(app: &tauri::AppHandle) {
    // 记录唤起前的前台窗口（用户正在操作的应用），供「粘贴到之前的窗口」使用
    #[cfg(windows)]
    {
        let fg = unsafe { win32::GetForegroundWindow() };
        PREV_WINDOW.store(fg, Ordering::Relaxed);
    }
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        // 唤起时通知前端聚焦全局搜索框
        let _ = win.emit("focus-search", ());
    }
}

/* ---- 全局搜索：开始菜单应用索引 ---- */

#[derive(serde::Serialize, Clone)]
struct AppEntry {
    name: String,
    path: String,
}

fn collect_apps(dir: &std::path::Path, out: &mut Vec<AppEntry>, depth: u32) {
    if depth > 4 {
        return;
    }
    let rd = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_apps(&p, out, depth + 1);
        } else if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
            let lext = ext.to_ascii_lowercase();
            if lext == "lnk" || lext == "url" {
                let name = p
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                if !name.is_empty() {
                    out.push(AppEntry {
                        name,
                        path: p.to_string_lossy().to_string(),
                    });
                }
            }
        }
    }
}

#[tauri::command]
fn search_apps(query: String) -> Vec<AppEntry> {
    static CACHE: std::sync::Mutex<Option<Vec<AppEntry>>> = std::sync::Mutex::new(None);
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return vec![];
    }
    let mut cache = CACHE.lock().unwrap();
    if cache.is_none() {
        let mut all = Vec::new();
        let prog_data = std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".into());
        collect_apps(
            std::path::Path::new(&prog_data)
                .join("Microsoft/Windows/Start Menu/Programs")
                .as_path(),
            &mut all,
            0,
        );
        let app_data = std::env::var("APPDATA").unwrap_or_default();
        if !app_data.is_empty() {
            collect_apps(
                std::path::Path::new(&app_data)
                    .join("Microsoft/Windows/Start Menu/Programs")
                    .as_path(),
                &mut all,
                0,
            );
        }
        *cache = Some(all);
    }
    let mut matched: Vec<AppEntry> = cache
        .as_ref()
        .unwrap()
        .iter()
        .filter(|a| a.name.to_lowercase().contains(&q))
        .take(8)
        .cloned()
        .collect();
    matched.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    matched
}

#[tauri::command]
fn launch_app(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        // ShellExecuteW 是系统「打开」的正统方式，能正确处理 .lnk / .url
        let file = win32::to_wide(&path);
        let verb = win32::to_wide("open");
        let r = unsafe {
            win32::ShellExecuteW(
                0,
                verb.as_ptr(),
                file.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                5, // SW_SHOW
            )
        };
        if r <= 32 {
            return Err(format!("ShellExecuteW failed with code {r}"));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Ok(())
    }
}

/* 把内容粘贴到唤起工具箱之前的窗口：写剪贴板 → 隐藏自己 → 切回原窗口 → 模拟 Ctrl+V。
   切前台用 AttachThreadInput（不向目标发送任何按键，避免触发其菜单栏）。 */
#[tauri::command]
fn paste_to_previous(app: tauri::AppHandle, text: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        cb.set_text(text).map_err(|e| e.to_string())?;

        let prev = PREV_WINDOW.load(Ordering::Relaxed);
        let valid = prev != 0 && unsafe { win32::IsWindow(prev) } != 0;
        if !valid {
            return Err("没有记录到之前的窗口".into());
        }

        if let Some(win) = app.get_webview_window("main") {
            let _ = win.hide(); // 焦点离开工具箱
        }
        std::thread::sleep(std::time::Duration::from_millis(150));

        unsafe {
            let cur_tid = win32::GetCurrentThreadId();
            let mut pid: u32 = 0;
            let target_tid = win32::GetWindowThreadProcessId(prev, &mut pid);
            if target_tid != 0 && target_tid != cur_tid {
                win32::AttachThreadInput(cur_tid, target_tid, 1);
            }
            win32::SetForegroundWindow(prev);
            if target_tid != 0 && target_tid != cur_tid {
                win32::AttachThreadInput(cur_tid, target_tid, 0);
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(120));

        // 纯 Ctrl+V，无任何修饰键残留，不会触发目标应用的菜单栏
        unsafe {
            win32::keybd_event(win32::VK_CONTROL, 0, 0, 0);
            win32::keybd_event(win32::VK_V, 0, 0, 0);
            win32::keybd_event(win32::VK_V, 0, win32::KEYEVENTF_KEYUP, 0);
            win32::keybd_event(win32::VK_CONTROL, 0, win32::KEYEVENTF_KEYUP, 0);
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, text);
        Ok(())
    }
}

#[tauri::command]
fn set_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let parsed: Shortcut = shortcut
        .parse()
        .map_err(|e| format!("invalid shortcut '{shortcut}': {e}"))?;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.register(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|e| e.to_string())
    } else {
        // 条目本就不存在时视为已关闭，避免报“找不到文件”
        if autolaunch.is_enabled().unwrap_or(false) {
            autolaunch.disable().map_err(|e| e.to_string())
        } else {
            Ok(())
        }
    }
}

#[tauri::command]
fn get_autostart(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_always_on_top(app: tauri::AppHandle, enabled: bool) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(enabled);
    }
}

#[tauri::command]
fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

fn main() {
    tauri::Builder::default()
        // 单实例：重复启动时唤起已有窗口并退出新进程（必须最先注册）
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        // 全局快捷键：唤起 / 隐藏主窗口（具体组合可在应用设置中修改）
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(win) = app.get_webview_window("main") {
                            let visible = win.is_visible().unwrap_or(false);
                            let minimized = win.is_minimized().unwrap_or(false);
                            if visible && !minimized {
                                let _ = win.hide();
                            } else {
                                show_main(app);
                            }
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            set_shortcut,
            set_autostart,
            get_autostart,
            set_always_on_top,
            set_close_to_tray,
            search_apps,
            launch_app,
            paste_to_previous
        ])
        .setup(|app| {
            use tauri_plugin_global_shortcut::GlobalShortcutExt;

            // 默认快捷键 Ctrl+Q；被占用不影响启动，用户可在设置中另选
            if let Err(e) = app.global_shortcut().register("Control+KeyQ") {
                eprintln!("global shortcut register failed: {e}");
            }

            // 托盘：左键点击唤起窗口，右键菜单可显示/退出
            let show = tauri::menu::MenuItem::with_id(app, "show", "显示主窗口 (快捷键)", true, None::<&str>)?;
            let quit = tauri::menu::MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("工具箱 · 在设置中可自定义快捷键")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        // 点 X：默认隐藏到托盘；可在设置中改为直接退出
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if CLOSE_TO_TRAY.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
