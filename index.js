const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const META_TOKEN = process.env.META_ACCESS_TOKEN;

// 1. Vérification du Webhook par Meta
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

// 2. Réception et Traitement des Messages
app.post('/webhook', async (req, res) => {
  const body = req.body;

  // Log complet pour voir TOUT ce que Meta envoie dès qu'un message arrive
  console.log('[PAYLOAD REÇU EN BRUT]:', JSON.stringify(body, null, 2));

  if (body.object === 'whatsapp_business_account') {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    // Récupération dynamique de l'ID du numéro de téléphone qui a reçu le message
    const phoneNumberId = value?.metadata?.phone_number_id || '1285975734605370';

    if (message) {
      const from = message.from;
      const text = message.text?.body?.toLowerCase();

      console.log(`[MESSAGE REÇU] De: ${from} | Texte: ${text} | PhoneID: ${phoneNumberId}`);

      if (text === 'vente' || text === 'menu' || text === '1') {
        await envoyerMenuCatalogue(from, phoneNumberId);
      } else {
        await envoyerMessageTexte(from, "Bienvenue sur B-Ticket ! Envoyez *VENTE* pour émettre un reçu.", phoneNumberId);
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// Fonction pour envoyer le catalogue
async function envoyerMenuCatalogue(to, phoneId) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${phoneId}/messages`,
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
    console.log('[ENVOI REUSSI] Catalogue envoyé à', to);
  } catch (error) {
    console.error("[ERREUR ENVOI CATALOGUE]:", error.response?.data || error.message);
  }
}

// Fonction utilitaire d'envoi de texte
async function envoyerMessageTexte(to, text, phoneId) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: text }
      },
      { headers: { Authorization: `Bearer ${META_TOKEN}` } }
    );
    console.log('[ENVOI REUSSI] Texte envoyé à', to);
  } catch (error) {
    console.error("[ERREUR ENVOI TEXTE]:", error.response?.data || error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook B-Ticket actif sur le port ${PORT}`);
});

// Page de politique de confidentialité requise par Meta
app.get('/privacy', (req, res) => {
  res.send('<h1>Politique de Confidentialité - B-Ticket</h1><p>B-Ticket utilise uniquement vos données WhatsApp pour le traitement automatique des reçus et catalogues. Aucune donnée personnelle n\'est conservée ou partagée avec des tiers.</p>');
});

