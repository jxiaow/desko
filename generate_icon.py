from PIL import Image, ImageDraw, ImageFont
import os

# 创建 1024x1024 的图像
size = 1024
img = Image.new('RGB', (size, size), color=(26, 115, 232))
draw = ImageDraw.Draw(img)

# 绘制圆角矩形背景
try:
    # 尝试加载字体
    font = ImageFont.truetype("arial.ttf", 600)
except:
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 600)
    except:
        font = ImageFont.load_default()

# 绘制 "D" 字母
text = "D"
bbox = draw.textbbox((0, 0), text, font=font)
text_width = bbox[2] - bbox[0]
text_height = bbox[3] - bbox[1]
x = (size - text_width) / 2
y = (size - text_height) / 2 - bbox[1]

draw.text((x, y), text, fill=(255, 255, 255), font=font)

# 保存
img.save('app-icon.png')
print('Icon generated: app-icon.png')
