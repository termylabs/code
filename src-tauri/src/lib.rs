mod agent;
mod agent_terminal;
mod db;
mod mentions;
mod shell_env;
mod terminal;
mod workspace;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Warm the login-shell PATH off the main thread so the first spawn is instant.
    std::thread::spawn(shell_env::login_path);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(agent::Agents::default())
        .manage(terminal::Terminals::default())
        .manage(agent_terminal::AgentTerminals::default())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(db::Db::open(&dir.join("termy.db"))?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            agent::agent_spawn,
            agent::agent_write,
            agent::agent_kill,
            workspace::fs_read_text,
            workspace::fs_write_text,
            workspace::git_branch,
            workspace::fs_read_image,
            mentions::project_files,
            mentions::skills_list,
            terminal::term_open,
            terminal::term_write,
            terminal::term_resize,
            terminal::term_close,
            agent_terminal::acp_terminal_create,
            agent_terminal::acp_terminal_output,
            agent_terminal::acp_terminal_wait,
            agent_terminal::acp_terminal_kill,
            agent_terminal::acp_terminal_release,
            db::db_projects_list,
            db::db_project_save,
            db::db_project_delete,
            db::db_threads_list,
            db::db_threads_search,
            db::db_thread_get,
            db::db_thread_save,
            db::db_thread_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Termy Code");
}
