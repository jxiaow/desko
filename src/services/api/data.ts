import { invoke } from '../transport'

export const dataApi = {
  getDbPath: (): Promise<string> => invoke('get_db_path'),
  createTestData: (): Promise<void> =>
    invoke('create_test_data'),
}
