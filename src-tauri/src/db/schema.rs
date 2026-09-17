use rusqlite::Connection;
use crate::error::AppError;

pub fn run_schema(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            url TEXT,
            username TEXT,
            encrypted_password TEXT NOT NULL,
            notes TEXT,
            category TEXT DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_entries_name ON entries(name);
        CREATE INDEX IF NOT EXISTS idx_entries_category ON entries(category);

        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content_html TEXT NOT NULL DEFAULT '',
            category TEXT DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notes_title ON notes(title);
        CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category);

        CREATE TABLE IF NOT EXISTS url_paths (
            id TEXT PRIMARY KEY,
            entry_id TEXT NOT NULL,
            path TEXT NOT NULL,
            label TEXT,
            notes TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_url_paths_entry_id ON url_paths(entry_id);

        CREATE TABLE IF NOT EXISTS file_shortcuts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            shortcut_type TEXT NOT NULL DEFAULT 'file',
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_file_shortcuts_name ON file_shortcuts(name);
    ")?;
    Ok(())
}
