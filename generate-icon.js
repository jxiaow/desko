const fs = require('fs');
const { createCanvas } = require('canvas');

const size = 1024;
const canvas = createCanvas(size, size);
const ctx = canvas.getContext('2d');

// 背景渐变
const gradient = ctx.createLinearGradient(0, 0, size, size);
gradient.addColorStop(0, '#1a73e8');
gradient.addColorStop(1, '#4285f4');
ctx.fillStyle = gradient;

// 圆角矩形
const radius = 180;
ctx.beginPath();
ctx.moveTo(radius, 0);
ctx.lineTo(size - radius, 0);
ctx.quadraticCurveTo(size, 0, size, radius);
ctx.lineTo(size, size - radius);
ctx.quadraticCurveTo(size, size, size - radius, size);
ctx.lineTo(radius, size);
ctx.quadraticCurveTo(0, size, 0, size - radius);
ctx.lineTo(0, radius);
ctx.quadraticCurveTo(0, 0, radius, 0);
ctx.closePath();
ctx.fill();

// 绘制 "D" 字母
ctx.fillStyle = '#ffffff';
ctx.font = 'bold 600px Arial';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('D', size / 2, size / 2 + 20);

// 保存
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync('app-icon.png', buffer);
console.log('Icon generated: app-icon.png');
