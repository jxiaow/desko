-- 测试数据（使用真实加密）
-- 导入前请确保已设置主密码

INSERT INTO entries (id, name, url, username, encrypted_password, notes, category, created_at, updated_at) VALUES 
('test-1', 'GitHub', 'https://github.com', 'user@example.com', '{"ciphertext":"0dA0hYcM7gdhhtizZjvM4ogz7AqMEeINI8FH","iv":"G0Jk4AviTwQLGD2d"}', '代码托管平台', '开发', 1789166719319, 1789166719319);

INSERT INTO entries (id, name, url, username, encrypted_password, notes, category, created_at, updated_at) VALUES 
('test-2', 'Gmail', 'https://mail.google.com', 'user@gmail.com', '{"ciphertext":"4R5GJrOMli+A2LgV8u6pKtKR74NQkE74ZJMk2g==","iv":"2Wm6CATtO9+c0VNB"}', '个人邮箱', '邮箱', 1789166719319, 1789166719319);

INSERT INTO entries (id, name, url, username, encrypted_password, notes, category, created_at, updated_at) VALUES 
('test-3', '钉钉', 'https://www.dingtalk.com', 'user@company.com', '{"ciphertext":"KtReeIND4nELjXu2ISFWaqFIHpPvXYurb3Dn","iv":"EbzgB6m1zFdh5jB4"}', '企业办公', '办公', 1789166719319, 1789166719319);

INSERT INTO entries (id, name, url, username, encrypted_password, notes, category, created_at, updated_at) VALUES 
('test-4', '阿里云', 'https://www.aliyun.com', 'admin', '{"ciphertext":"9lPR5cK/CvCokq0FzvmNhgduokwClV4AGR+h9d4=","iv":"ZtZry7nx8+DFzdxW"}', '云服务', '开发', 1789166719319, 1789166719319);

INSERT INTO entries (id, name, url, username, encrypted_password, notes, category, created_at, updated_at) VALUES 
('test-5', '腾讯文档', 'https://docs.qq.com', 'user@company.com', '{"ciphertext":"y12PNoX0mT3dhXdz0GNOD9E4ocx4h4ZW5w==","iv":"sqH+hQTkZZbHg/L3"}', '在线文档', '办公', 1789166719319, 1789166719319);

INSERT INTO entries (id, name, url, username, encrypted_password, notes, category, created_at, updated_at) VALUES 
('test-6', '知乎', 'https://www.zhihu.com', 'zhangsan', '{"ciphertext":"Ha5EheMGk/BmvAPfXSUeB6KBQ+v21I/U+Os=","iv":"hqh24Tsi6HLg0AYG"}', '知识问答', '社交', 1789166719319, 1789166719319);

INSERT INTO entries (id, name, url, username, encrypted_password, notes, category, created_at, updated_at) VALUES 
('test-7', 'Outlook', 'https://outlook.office.com', 'user@company.com', '{"ciphertext":"kYB/sGZAP7tQ0xIDJCJnaUgXXV1LwUhG97s=","iv":"xCmBEe30R5+9qk3l"}', '企业邮箱', '邮箱', 1789166719319, 1789166719319);

INSERT INTO entries (id, name, url, username, encrypted_password, notes, category, created_at, updated_at) VALUES 
('test-8', 'Jira', 'https://jira.company.com', 'user', '{"ciphertext":"BPxhDSLU+bivUsT740f/wpkt+3rJgzlkmn4=","iv":"L0kkB97VFPLNH2y6"}', '项目管理', '办公', 1789166719319, 1789166719319);

INSERT INTO entries (id, name, url, username, encrypted_password, notes, category, created_at, updated_at) VALUES 
('test-9', 'Stack Overflow', 'https://stackoverflow.com', 'dev_user', '{"ciphertext":"iIUEHDU3ZMGrRdMA/Rfm7QY1bwec0LfOIOk=","iv":"xH1ZmufOHPwt95WL"}', '技术问答', '开发', 1789166719319, 1789166719319);

INSERT INTO entries (id, name, url, username, encrypted_password, notes, category, created_at, updated_at) VALUES 
('test-10', '微信', 'https://weixin.qq.com', 'zhangsan', '{"ciphertext":"QIID1gBVKgiEvezE0t4VlgEtSnBiDhWomw==","iv":"ONPC/v32SRyZ35O0"}', '社交聊天', '社交', 1789166719319, 1789166719319);

