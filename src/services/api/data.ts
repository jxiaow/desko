import { invoke } from '@tauri-apps/api/core'

export const dataApi = {
  exportSql: (): Promise<string> => invoke('export_sql'),
  getDbPath: (): Promise<string> => invoke('get_db_path'),
  importSql: (sql: string): Promise<void> =>
    invoke('import_sql', { sql }),
  createTestData: (): Promise<void> =>
    invoke('create_test_data'),
}
