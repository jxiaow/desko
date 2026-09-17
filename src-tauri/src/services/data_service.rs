use crate::error::AppError;

pub fn validate_import_sql(sql: &str) -> Result<(), AppError> {
    let mut chars = sql.chars().peekable();

    loop {
        skip_sql_whitespace(&mut chars);

        match chars.peek() {
            None => break,
            Some('-') => {
                let mut next = chars.clone();
                next.next();
                if next.peek() == Some(&'-') {
                    skip_sql_line_comment(&mut chars);
                    continue;
                }
                break;
            }
            Some('/') => {
                let mut next = chars.clone();
                next.next();
                if next.peek() == Some(&'*') {
                    skip_sql_block_comment(&mut chars)?;
                    continue;
                }
                break;
            }
            _ => break,
        }
    }

    loop {
        skip_sql_whitespace(&mut chars);
        if chars.peek().is_none() {
            break;
        }

        while matches!(chars.peek(), Some('-') | Some('/')) {
            let mut probe = chars.clone();
            let c1 = probe.next().unwrap();
            match (c1, probe.peek()) {
                ('-', Some(&'-')) => {
                    chars.next();
                    skip_sql_line_comment(&mut chars);
                }
                ('/', Some(&'*')) => {
                    chars.next();
                    skip_sql_block_comment(&mut chars)?;
                }
                _ => break,
            }
            skip_sql_whitespace(&mut chars);
        }

        let mut stmt_chars: Vec<char> = Vec::new();
        let mut in_string = false;

        loop {
            match chars.peek() {
                None => break,
                Some(&'\'') if in_string => {
                    stmt_chars.push('\'');
                    chars.next();
                    if chars.peek() == Some(&'\'') {
                        stmt_chars.push('\'');
                        chars.next();
                    } else {
                        in_string = false;
                    }
                }
                Some(&'\'') => {
                    in_string = true;
                    stmt_chars.push('\'');
                    chars.next();
                }
                Some(&';') if !in_string => {
                    chars.next();
                    break;
                }
                Some(&c) => {
                    stmt_chars.push(c);
                    chars.next();
                }
            }
        }

        let stmt: String = stmt_chars.iter().collect();
        let trimmed = stmt.trim();
        if trimmed.is_empty() {
            continue;
        }

        let upper = trimmed.to_uppercase();
        if upper.starts_with("INSERT") {
        } else if upper.starts_with("CREATE TABLE") || upper.starts_with("CREATE INDEX") {
        } else if upper.starts_with("CREATE") {
            let preview = if trimmed.len() > 50 { &trimmed[..50] } else { trimmed };
            return Err(AppError::Database(format!(
                "Invalid SQL statement: CREATE TRIGGER/VIEW is not allowed. Got: {}",
                preview
            )));
        } else {
            let preview = if trimmed.len() > 50 { &trimmed[..50] } else { trimmed };
            return Err(AppError::Database(format!(
                "Invalid SQL statement: only INSERT and CREATE TABLE/INDEX are allowed. Got: {}",
                preview
            )));
        }
    }

    Ok(())
}

fn skip_sql_whitespace<I: Iterator<Item = char>>(chars: &mut std::iter::Peekable<I>) {
    while matches!(chars.peek(), Some(c) if c.is_whitespace()) {
        chars.next();
    }
}

fn skip_sql_line_comment<I: Iterator<Item = char>>(chars: &mut std::iter::Peekable<I>) {
    while let Some(&c) = chars.peek() {
        chars.next();
        if c == '\n' {
            break;
        }
    }
}

fn skip_sql_block_comment<I: Iterator<Item = char>>(
    chars: &mut std::iter::Peekable<I>,
) -> Result<(), AppError> {
    let mut prev = ' ';
    loop {
        match chars.next() {
            None => return Err(AppError::Database("Unterminated block comment in SQL".into())),
            Some(c) if c == '/' && prev == '*' => return Ok(()),
            Some(c) => prev = c,
        }
    }
}
