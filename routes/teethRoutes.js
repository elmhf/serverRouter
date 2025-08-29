import { Router } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';

const router = Router();

// Helper function to get data from JSON files
async function getData(fileName) {
  try {
    const filePath = join(process.cwd(), 'data', fileName);
    const data = readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading file:', error.message);
    return {};
  }
}

// API: /Test endpoint for teeth data
router.post("/test", async (req, res) => {
  try {
    const image = req.body.image;
    console.log(image, "image");

    console.log('Test endpoint hit');
    const page = Math.floor(Math.random() * 6) + 1;
    console.log(page);

    const data = await getData(`${page}.json`);
    const data2 = data["teeth"].map((item) => ({
      "tooth": item["toothNumber"],
      "Approve": true,
      "Hedding": false,
      "Comment": {}
    }));

    res.status(200).json({ data, data2 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

export default router; 