// 开发辅助：批量添加测试数据
// 在浏览器控制台中运行：
// import('./dev-helpers').then(m => m.addTestData())

import { api } from './services/api'

const testData = [
  { name: 'GitHub', url: 'https://github.com', username: 'user@example.com', password: 'Gh!tHub2024', notes: '代码托管平台', category: '开发' },
  { name: 'Gmail', url: 'https://mail.google.com', username: 'user@gmail.com', password: 'Gm@il#Secure', notes: '个人邮箱', category: '邮箱' },
  { name: '钉钉', url: 'https://www.dingtalk.com', username: 'user@company.com', password: 'Ding!Talk88', notes: '企业办公', category: '办公' },
  { name: '阿里云', url: 'https://www.aliyun.com', username: 'admin', password: 'Ali#Cloud2024', notes: '云服务', category: '开发' },
  { name: '腾讯文档', url: 'https://docs.qq.com', username: 'user@company.com', password: 'QQ@Docs66', notes: '在线文档', category: '办公' },
  { name: '知乎', url: 'https://www.zhihu.com', username: 'zhangsan', password: 'Zhihu!2024', notes: '知识问答', category: '社交' },
  { name: 'Outlook', url: 'https://outlook.office.com', username: 'user@company.com', password: 'Out@look99', notes: '企业邮箱', category: '邮箱' },
  { name: 'Jira', url: 'https://jira.company.com', username: 'user', password: 'J!ra#Board', notes: '项目管理', category: '办公' },
  { name: 'Stack Overflow', url: 'https://stackoverflow.com', username: 'dev_user', password: 'St@ck#2024', notes: '技术问答', category: '开发' },
  { name: '微信', url: 'https://weixin.qq.com', username: 'zhangsan', password: 'Wx!Chat88', notes: '社交聊天', category: '社交' },
]

export async function addTestData() {
  for (const item of testData) {
    try {
      await api.createEntry(item)
      console.log(`Added: ${item.name}`)
    } catch (e) {
      console.error(`Failed to add ${item.name}:`, e)
    }
  }
  console.log('Done!')
}
