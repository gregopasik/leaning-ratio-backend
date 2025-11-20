// backend/server.js
// Prosty backend proxy dla API Anthropic

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Zwiększony limit dla obrazów base64

// Rate limiting (prosta implementacja)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minuta
const MAX_REQUESTS_PER_WINDOW = 10;

function checkRateLimit(ip) {
  const now = Date.now();
  const userRequests = rateLimitMap.get(ip) || [];
  
  // Usuń stare requesty
  const recentRequests = userRequests.filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  
  recentRequests.push(now);
  rateLimitMap.set(ip, recentRequests);
  return true;
}

// Endpoint do analizy obrazu
app.post('/api/analyze-image', async (req, res) => {
  try {
    const { image, type } = req.body;
    const clientIP = req.ip || req.connection.remoteAddress;

    // Sprawdź rate limit
    if (!checkRateLimit(clientIP)) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded. Please wait a minute.' 
      });
    }

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Wywołanie API Anthropic
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: image
                }
              },
              {
                type: "text",
                text: `Przeanalizuj tę etykietę żywieniową i wyciągnij wartości odżywcze.
Szukaj wartości NA 100g produktu (nie na porcję!).

BARDZO WAŻNE: Zwróć TYLKO czysty obiekt JSON bez żadnego dodatkowego tekstu, markdown, ani wyjaśnień.

Format:
{"kcal": liczba_kalorii, "protein": liczba_gramów_białka}

Przykład:
{"kcal": 450, "protein": 25}

Jeśli nie znajdziesz dokładnych wartości, zwróć:
{"kcal": 0, "protein": 0}

Pamiętaj: sam JSON, nic więcej!`
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Anthropic API Error:', errorData);
      return res.status(response.status).json({ 
        error: 'API request failed',
        details: errorData
      });
    }

    const data = await response.json();
    
    if (data.content && data.content[0]) {
      let responseText = data.content[0].text;
      
      // Usuń markdown jeśli występuje
      responseText = responseText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      try {
        const result = JSON.parse(responseText);
        
        // Walidacja danych
        if (typeof result.kcal !== 'number' || typeof result.protein !== 'number') {
          throw new Error('Invalid data format');
        }

        // Zwróć wyniki
        return res.json({
          kcal: Math.round(result.kcal),
          protein: Math.round(result.protein * 10) / 10 // 1 miejsce po przecinku
        });
      } catch (parseError) {
        console.error('JSON Parse Error:', parseError, 'Response:', responseText);
        return res.status(500).json({ 
          error: 'Failed to parse OCR response',
          kcal: 0,
          protein: 0
        });
      }
    } else {
      return res.status(500).json({ 
        error: 'Invalid API response',
        kcal: 0,
        protein: 0
      });
    }

  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString() 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
  console.log(`📍 API endpoint: http://localhost:${PORT}/api/analyze-image`);
  
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  WARNING: ANTHROPIC_API_KEY not set in environment variables!');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});
