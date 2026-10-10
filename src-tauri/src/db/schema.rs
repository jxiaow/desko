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

        CREATE TABLE IF NOT EXISTS bypass_targets (
            id TEXT PRIMARY KEY,
            host TEXT NOT NULL UNIQUE,
            input TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL,
            port INTEGER NOT NULL DEFAULT 443,
            path TEXT NOT NULL DEFAULT '',
            scheme TEXT NOT NULL DEFAULT 'https',
            address TEXT NOT NULL DEFAULT '',
            interface_name TEXT NOT NULL DEFAULT '',
            next_hop TEXT NOT NULL DEFAULT '',
            verdict TEXT NOT NULL DEFAULT '',
            stale INTEGER NOT NULL DEFAULT 0,
            note TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            checked_at INTEGER NOT NULL DEFAULT 0
        );
        -- host 上的 UNIQUE 约束自带索引，这条曾是多余的第二份；留一句幂等清理，
        -- 收掉早期开发库里已经建出来的那枚
        DROP INDEX IF EXISTS idx_bypass_targets_host;

        CREATE TABLE IF NOT EXISTS tunnel_services (
            id TEXT PRIMARY KEY,
            hostname TEXT NOT NULL UNIQUE,
            port INTEGER NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            preset TEXT NOT NULL DEFAULT '',
            routed INTEGER NOT NULL DEFAULT 0,
            public_password_sha256 TEXT NOT NULL DEFAULT '',
            public_read_only INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
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

    // 迁移：单条加密。正文进 cipher（DEK 加密），明文列清空；
    // DEK 存两份封条——口令封条供日常解锁，主密钥封条供兜底找回
    let has_enc: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name='enc'",
        [],
        |r| r.get(0),
    ).unwrap_or(0) > 0;

    if !has_enc {
        conn.execute_batch(
            "ALTER TABLE notes ADD COLUMN enc INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE notes ADD COLUMN cipher TEXT NOT NULL DEFAULT '';
             ALTER TABLE notes ADD COLUMN cipher_iv TEXT NOT NULL DEFAULT '';
             ALTER TABLE notes ADD COLUMN wrap_pass TEXT NOT NULL DEFAULT '';
             ALTER TABLE notes ADD COLUMN pass_salt TEXT NOT NULL DEFAULT '';
             ALTER TABLE notes ADD COLUMN wrap_master TEXT NOT NULL DEFAULT '';"
        )?;
    }

    // 迁移：直连清单记下粘贴原文。端口/路径/掩码都不在 host 列里，
    // 重探只按 host 走会把 http://host:9090/a 探成 https://host:443
    let has_bp_input: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('bypass_targets') WHERE name='input'",
        [],
        |r| r.get(0),
    ).unwrap_or(0) > 0;

    if !has_bp_input {
        conn.execute_batch("ALTER TABLE bypass_targets ADD COLUMN input TEXT NOT NULL DEFAULT '';")?;
    }

    // 迁移：穿透服务带上公网策略。口令只存摘要，且只对 desko 自己起的服务有意义——
    // 第三方本机端口不在我们的请求链路上，收不到这份策略。只读默认开：端出去先窄后宽。
    let has_ts_policy: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('tunnel_services') WHERE name='public_password_sha256'",
        [],
        |r| r.get(0),
    ).unwrap_or(0) > 0;

    if !has_ts_policy {
        conn.execute_batch(
            "ALTER TABLE tunnel_services ADD COLUMN public_password_sha256 TEXT NOT NULL DEFAULT '';
             ALTER TABLE tunnel_services ADD COLUMN public_read_only INTEGER NOT NULL DEFAULT 1;"
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
