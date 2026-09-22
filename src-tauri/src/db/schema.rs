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

        CREATE TABLE IF NOT EXISTS mfa_tokens (
            id TEXT PRIMARY KEY,
            issuer TEXT NOT NULL DEFAULT '',
            label TEXT NOT NULL DEFAULT '',
            secret_enc TEXT NOT NULL,
            algorithm TEXT NOT NULL DEFAULT 'SHA1',
            digits INTEGER NOT NULL DEFAULT 6,
            period INTEGER NOT NULL DEFAULT 30,
            created_at INTEGER NOT NULL
        );
    ")?;

    // 迁移：为 notes 表添加 pinned 和 starred 字段（如果不存在）
    let has_pinned: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name='pinned'",
        [],
        |r| r.get(0),
    ).unwrap_or(0) > 0;

    if !has_pinned {
        conn.execute_batch(
            "ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE notes ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;"
        )?;
    }

    // 创建 note_attachments 表
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS note_attachments (
            id TEXT PRIMARY KEY,
            note_id TEXT NOT NULL,
            file_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            mime_type TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_note_attachments_note_id ON note_attachments(note_id);"
    )?;

    Ok(())
}
