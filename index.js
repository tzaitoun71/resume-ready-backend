require('dotenv').config();
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { MongoClient } = require('mongodb');
const OpenAI = require('openai');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const mongoUri = process.env.MONGODB_URI;
let db;

// Connect to MongoDB
MongoClient.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(client => {
    db = client.db('resume-ready');
    console.log('Connected to MongoDB');
  })
  .catch(err => console.error('Failed to connect to MongoDB', err));

app.post('/api/extract-pdf-text', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const userId = req.body.userId;

    if (!file || !userId) {
      return res.status(400).json({ error: 'File and userId are required' });
    }

    const extractedText = await pdfParse(file.buffer).then(data => data.text);

    if (!extractedText) {
      console.error("No text extracted from PDF.");
      return res.status(500).json({ error: 'Failed to extract text from PDF' });
    }

    console.log("Extracted PDF text:", extractedText);

    // Send extracted text to OpenAI to categorize and structure
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an assistant that organizes the following text into a structured format similar to a resume layout. Use commas to separate items where appropriate, and list information in a clear, concise manner with each point or category distinctly separated. Maintain the original order of the text without adding introductory messages or additional instructions.',
        },
        {
          role: 'user',
          content: `Organize and categorize the following text: ${extractedText}`,
        },
      ],
      max_tokens: 2000,
    });

    const organizedText = response.choices?.[0]?.message?.content || '';
    console.log("Organized Text from OpenAI:", organizedText);

    if (!organizedText) {
      console.error("Failed to receive organized text from OpenAI.");
      return res.status(500).json({ error: 'Failed to organize text' });
    }

    const usersCollection = db.collection('users');

    console.log("Attempting to update MongoDB with userId:", userId);

    const existingUser = await usersCollection.findOne({ userId });
    if (!existingUser) {
      console.error("User not found in MongoDB with userId:", userId);
      return res.status(404).json({ error: 'User not found' });
    }

    const updateResult = await usersCollection.updateOne(
      { userId },
      { $set: { resume: organizedText } }
    );

    if (updateResult.matchedCount === 0) {
      console.error("No user document matched the query for userId:", userId);
      return res.status(404).json({ error: 'Failed to update resume, user not found' });
    }

    if (updateResult.modifiedCount === 0) {
      console.warn("User document found but resume not updated for userId:", userId);
      return res.status(500).json({ error: 'Resume was not updated' });
    }

    console.log("Resume updated successfully in MongoDB for userId:", userId);

    res.status(200).json({ message: 'PDF processed and saved successfully', organizedText });
  } catch (error) {
    console.error('Error processing PDF:', error.message);
    res.status(500).json({ error: error.message || 'Error processing PDF' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
