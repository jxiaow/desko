from PIL import Image, ImageDraw, ImageFont
import math

# Create a 1024x1024 image with a blue gradient background
size = 1024
img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Draw a circular background with gradient effect
# Create gradient from top-left to bottom-right
for y in range(size):
    for x in range(size):
        # Check if point is inside circle
        cx, cy = size/2, size/2
        radius = size/2
        if (x - cx)**2 + (y - cy)**2 <= radius**2:
            # Create gradient
            progress = (x + y) / (2 * size)
            r = int(26 + (115 - 26) * progress)
            g = int(115 + (232 - 115) * progress)
            b = int(232 + (232 - 232) * progress)
            img.putpixel((x, y), (r, g, b, 255))

# Draw the letter "D" in white
try:
    # Try to use a bold font
    font = ImageFont.truetype("arialbd.ttf", 600)
except:
    try:
        font = ImageFont.truetype("arial.ttf", 600)
    except:
        font = ImageFont.load_default()

# Get text bounding box
text = "D"
bbox = draw.textbbox((0, 0), text, font=font)
text_width = bbox[2] - bbox[0]
text_height = bbox[3] - bbox[1]

# Center the text
x = (size - text_width) / 2 - bbox[0]
y = (size - text_height) / 2 - bbox[1]

# Draw white text
draw.text((x, y), text, fill=(255, 255, 255, 255), font=font)

# Save the icon
img.save('app-icon.png')
print("Icon created: app-icon.png")
