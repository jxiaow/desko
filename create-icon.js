const fs = require('fs');
const { createCanvas } = require('canvas');

const canvas = createCanvas(1024, 1024);
const ctx = canvas.getContext('2d');

// Blue background
ctx.fillStyle = '#1a73e8';
ctx.fillRect(0, 0, 1024, 1024);

// White "案" character
ctx.fillStyle = '#ffffff';
ctx.font = 'bold 600px sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('案', 512, 512);

const buffer = canvas.toBuffer('image/png');
fs.writeFileSync('app-icon.png', buffer);
console.log('Icon created');
