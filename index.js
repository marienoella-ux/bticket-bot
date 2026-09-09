const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const META_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = '1285975734605370';

// 1. Verification du Webhook par Meta (Configuration initiale)
app.get('/webhook', (req, res) => {
  const verify_token = process.env.WEBHOOK_VERIFY_TOKEN || 'bticket_secret_token_2026';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === verify_token) {
    console.log('WEBHOOK_VERIFIED');
    return res.status(200).set('Content-Type', 'text/plain').send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// 2. Reception et Traitement des Messages Vendeur
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (message) {
      const from = message.from;
      const text = message.text?.body?.toLowerCase();

      if (text === 'vente' || text === 'menu' || text === '1') {
        await envoyerMenuCatalogue(from);
      } else {
        await envoyerMessageTexte(from, "Bienvenue sur B-Ticket ! Envoyez *VENTE* pour émettre un reçu.");
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// Fonction pour envoyer un message interactif (Catalogue)
async function envoyerMenuCatalogue(to) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: 'B-Ticket - Nouvelle Vente' },
          body: { text: "Sélectionnez l'article vendu dans votre catalogue :" },
          action: {
            button: 'Voir le catalogue',
            sections: [
              {
                title: 'Vos Articles',
                rows: [
                  { id: 'art_1', title: 'T-shirt Coton', description: '5 000 FCFA' },
                  { id: 'art_2', title: 'Jean Noir', description: '12 000 FCFA' },
                  { id: 'art_free', title: 'Article Hors Catalogue', description: 'Saisie prix libre' }
                ]
              }
            ]
          }
        }
      },
      { headers: { Authorization: `Bearer ${META_TOKEN}` } }
    );
  } catch (error) {
    console.error("Erreur lors de l'envoi du menu:", error.response?.data || error.message);
  }
}

// Fonction utilitaire d'envoi de texte
async function envoyerMessageTexte(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: text }
      },
      { headers: { Authorization: `Bearer ${META_TOKEN}` } }
    );
  } catch (error) {
    console.error("Erreur lors de l'envoi du texte:", error.response?.data || error.message);
  }
}

// Port dynamique pour Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook B-Ticket actif sur le port ${PORT}`);
});