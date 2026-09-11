const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Initialisation de Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const META_TOKEN = process.env.META_ACCESS_TOKEN;

// 1. Page de politique de confidentialité
app.get('/privacy', (req, res) => {
  res.send('<h1>Politique de Confidentialité - B-Ticket</h1><p>B-Ticket utilise uniquement vos données WhatsApp pour émettre vos reçus de vente. Aucune donnée n\'est partagée avec des tiers.</p>');
});

// 2. Vérification du Webhook par Meta
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

// 3. Traitement des Messages
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    const phoneNumberId = value?.metadata?.phone_number_id || '1279459025258537';

    if (message) {
      const from = message.from; // Numéro WhatsApp du vendeur
      
      let userText = '';
      if (message.type === 'text') {
        userText = message.text.body.trim();
      } else if (message.type === 'interactive' && message.interactive.list_reply) {
        userText = message.interactive.list_reply.id;
      }

      console.log(`[MESSAGE REÇU] De: ${from} | Contenu: ${userText}`);

      await traiterMessageEntrant(from, userText, phoneNumberId);
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// --- LOGIQUE METIER & ROUTER ---

async function traiterMessageEntrant(phone, text, phoneId) {
  // A. Vérifier si l'utilisateur existe dans Supabase
  let { data: user } = await supabase.from('users').select('*').eq('phone_number', phone).single();

  // B. Récupérer l'état de la conversation
  let { data: conv } = await supabase.from('conversations').select('*').eq('phone_number', phone).single();

  // 1. CAS : UTILISATEUR INCONNU -> DÉBUT ONBOARDING
  if (!user) {
    if (!conv) {
      await supabase.from('conversations').insert([{ phone_number: phone, step: 'ONBOARDING_FIRST_NAME' }]);
      return await envoyerTexte(phone, "Bienvenue sur *B-Ticket* ! 🧾\n\nPour commencer la création de votre compte, quel est votre *Prénom* ?", phoneId);
    }

    if (conv.step === 'ONBOARDING_FIRST_NAME') {
      await supabase.from('conversations').update({ step: 'ONBOARDING_SHOP_NAME', data: { first_name: text } }).eq('phone_number', phone);
      return await envoyerTexte(phone, `Ravi de vous rencontrer ${text} ! 👋\n\nQuel est le *Nom de votre boutique* ou commerce ?`, phoneId);
    }

    if (conv.step === 'ONBOARDING_SHOP_NAME') {
      const firstName = conv.data.first_name;
      const shopName = text;

      await supabase.from('users').insert([{
        phone_number: phone,
        first_name: firstName,
        shop_name: shopName,
        receipt_quota: 0,
        is_approved: false
      }]);

      await supabase.from('conversations').delete().eq('phone_number', phone);

      return await envoyerTexte(
        phone,
        `Félicitations *${firstName}* ! La boutique *${shopName}* a été enregistrée avec succès. 🎉\n\n` +
        `Pour activer votre compte et obtenir votre quota de reçus :\n` +
        `👉 Effectuez votre règlement par Orange Money / Mobile Money au **Code Marchand OM : 123456**.\n` +
        `Tarif : 5 000 FCFA = 100 Reçus.\n\n` +
        `Dès réception de votre paiement, votre compte sera activé dans les plus brefs délais !`,
        phoneId
      );
    }
  }

  // 2. CAS : UTILISATEUR PAS ENCORE APPROUVÉ
  if (user && !user.is_approved) {
    return await envoyerTexte(
      phone,
      `Bonjour ${user.first_name} ! ⏳ Votre compte pour *${user.shop_name}* est en attente de validation.\n\n` +
      `Si vous avez déjà effectué votre paiement, veuillez patienter la validation administrative.`,
      phoneId
    );
  }

  // 3. CAS : UTILISATEUR VALIDE
  if (user && user.is_approved) {
    const textLower = text.toLowerCase();

    if (textLower === 'vente' || textLower === 'menu' || textLower === '1') {
      await ouvrirCatalogueVendeur(phone, user, phoneId);
    } 
    // Détection de l'ajout d'articles (Si le texte contient une virgule ex: "T-shirt Coton, 5000")
    else if (text.includes(',')) {
      await enregistrerArticlesCatalogue(phone, text, phoneId);
    } 
    else {
      await envoyerTexte(
        phone,
        `Bonjour *${user.first_name}* (${user.shop_name}) ! 👋\n` +
        `Solde de reçus : *${user.receipt_quota} restants*\n\n` +
        `• Envoyez *VENTE* pour émettre un nouveau reçu.\n` +
        `• Pour ajouter des articles à votre catalogue, envoyez-les au format :\n` +
        `  _Nom de l'article, Prix_\n` +
        `  _(Exemple : Pantalon Jean, 12000)_`,
        phoneId
      );
    }
  }
}

// Fonction pour enregistrer des articles dans le catalogue Supabase
async function enregistrerArticlesCatalogue(phone, rawText, phoneId) {
  // Découper par ligne au cas où plusieurs articles sont envoyés d'un coup
  const lines = rawText.split('\n');
  const productsToInsert = [];
  let errorCount = 0;

  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length >= 2) {
      const name = parts[0].trim();
      const priceStr = parts[1].replace(/[^0-9]/g, ''); // Extraire uniquement les chiffres
      const price = parseInt(priceStr, 10);

      if (name && !isNaN(price) && price > 0) {
        productsToInsert.push({
          user_phone: phone,
          name: name,
          price: price
        });
      } else {
        errorCount++;
      }
    }
  }

  if (productsToInsert.length > 0) {
    const { error } = await supabase.from('products').insert(productsToInsert);

    if (error) {
      console.error("[ERREUR SUPABASE PRODUCTS]:", error);
      return await envoyerTexte(phone, `❌ Erreur Supabase : ${error.message || JSON.stringify(error)}`, phoneId);
    }

    let messageConfirmation = `✅ *${productsToInsert.length} article(s) ajouté(s) à votre catalogue !*\n\n`;
    productsToInsert.forEach(p => {
      messageConfirmation += `• *${p.name}* : ${p.price.toLocaleString()} FCFA\n`;
    });
    messageConfirmation += `\nEnvoyez *VENTE* pour voir votre catalogue mis à jour !`;

    await envoyerTexte(phone, messageConfirmation, phoneId);
  } else {
    await envoyerTexte(
      phone,
      `⚠️ Aucun article valide détecté.\n\nAssurez-vous d'utiliser le format :\n*Nom de l'article, Prix*\n\n_Exemple : Chaussures Cuir, 15000_`,
      phoneId
    );
  }
}

// Fonction d'envoi du catalogue Supabase
async function ouvrirCatalogueVendeur(phone, user, phoneId) {
  let { data: products } = await supabase.from('products').select('*').eq('user_phone', phone);

  if (!products || products.length === 0) {
    return await envoyerTexte(
      phone,
      `Votre catalogue est actuellement vide.\n\n` +
      `Pour ajouter vos articles, envoyez-les sous le format :\n` +
      `*Article, Prix*\n\n` +
      `Exemple :\n_T-shirt Coton, 5000_\n_Jean Noir, 12000_`,
      phoneId
    );
  }

  const rows = products.slice(0, 10).map(p => ({
    id: `prod_${p.id}`,
    title: p.name.substring(0, 24),
    description: `${p.price.toLocaleString()} FCFA`
  }));

  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: `B-Ticket - ${user.shop_name}` },
          body: { text: "Sélectionnez l'article vendu :" },
          action: {
            button: 'Voir mon catalogue',
            sections: [{ title: 'Articles disponibles', rows: rows }]
          }
        }
      },
      { headers: { Authorization: `Bearer ${META_TOKEN}` } }
    );
  } catch (error) {
    console.error("[ERREUR ENVOI CATALOGUE]:", error.response?.data || error.message);
  }
}

// Helper d'envoi de texte
async function envoyerTexte(to, text, phoneId) {
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
  } catch (error) {
    console.error("[ERREUR ENVOI TEXTE]:", error.response?.data || error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`B-Ticket Bot actif sur le port ${PORT}`);
});
