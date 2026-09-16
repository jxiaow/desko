-- 测试数据
INSERT INTO entries (id, name, url, username, encrypted_password, notes, category, created_at, updated_at) VALUES 
('test-1', 'GitHub', 'https://github.com', 'user@example.com', '{"ciphertext":"test","iv":"test"}', '代码托管平台', '开发', 1704067200000, 1704067200000),
('test-2', 'Gmail', 'https://mail.google.com', 'user@gmail.com', '{"ciphertext":"test","iv":"test"}', '个人邮箱', '邮箱', 1704067200000, 1704067200000),
('test-3', '钉钉', 'https://www.dingtalk.com', 'user@company.com', '{"ciphertext":"test","iv":"test"}', '企业办公', '办公', 1704067200000, 1704067200000),
('test-4', '微信', 'https://weixin.qq.com', 'user', '{"ciphertext":"test","iv":"test"}', '社交聊天', '社交', 1704067200000, 1704067200000),
('test-5', '阿里云', 'https://www.aliyun.com', 'admin', '{"ciphertext":"test","iv":"test"}', '云服务', '开发', 1704067200000, 1704067200000),
('test-6', '腾讯文档', 'https://docs.qq.com', 'user@company.com', '{"ciphertext":"test","iv":"test"}', '在线文档', '办公', 1704067200000, 1704067200000),
('test-7', '知乎', 'https://www.zhihu.com', 'user', '{"ciphertext":"test","iv":"test"}', '知识问答', '社交', 1704067200000, 1704067200000),
('test-8', 'Outlook', 'https://outlook.office.com', 'user@company.com', '{"ciphertext":"test","iv":"test"}', '企业邮箱', '邮箱', 1704067200000, 1704067200000),
('test-9', 'Jira', 'https://jira.company.com', 'user', '{"ciphertext":"test","iv":"test"}', '项目管理', '办公', 1704067200000, 1704067200000),
('test-10', 'Stack Overflow', 'https://stackoverflow.com', 'user', '{"ciphertext":"test","iv":"test"}', '技术问答', '开发', 1704067200000, 1704067200000);
