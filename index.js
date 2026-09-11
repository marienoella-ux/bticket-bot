const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const META_TOKEN = process.env.META_ACCESS_TOKEN;

app.get('/privacy', (req, res) => {
  res.send('<h1>Politique de Confidentialité - B-Ticket</h1><p>B-Ticket utilise uniquement vos données WhatsApp pour émettre vos reçus de vente.</p>');
});

app.get('/webhook', (req, res) => {
  const verify_token = process.env.WEBHOOK_VERIFY_TOKEN || 'bticket_secret_token_2026';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === verify_token) {
    return res.status(200).set('Content-Type', 'text/plain').send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    const phoneNumberId = value?.metadata?.phone_number_id || '1279459025258537';

    if (message) {
      const from = message.from;
      let userText = '';
      let interactiveId = null;

      if (message.type === 'text') {
        userText = message.text.body.trim();
      } else if (message.type === 'interactive' && message.interactive.list_reply) {
        interactiveId = message.interactive.list_reply.id;
        userText = message.interactive.list_reply.title;
      }

      console.log(`[MESSAGE REÇU] De: ${from} | Text: ${userText} | InteractiveID: ${interactiveId}`);
      await traiterMessageEntrant(from, userText, interactiveId, phoneNumberId);
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// --- ROUTER DE CONVERSATION ---

async function traiterMessageEntrant(phone, text, interactiveId, phoneId) {
  let { data: user } = await supabase.from('users').select('*').eq('phone_number', phone).single();
  let { data: conv } = await supabase.from('conversations').select('*').eq('phone_number', phone).single();

  // 1. UTILISATEUR INCONNU -> ONBOARDING
  if (!user) {
    if (!conv) {
      await supabase.from('conversations').insert([{ phone_number: phone, step: 'ONBOARDING_FIRST_NAME' }]);
      return await envoyerTexte(phone, "Bienvenue sur *B-Ticket* ! 🧾\n\nQuel est votre *Prénom* ?", phoneId);
    }

    if (conv.step === 'ONBOARDING_FIRST_NAME') {
      await supabase.from('conversations').update({ step: 'ONBOARDING_SHOP_NAME', data: { first_name: text } }).eq('phone_number', phone);
      return await envoyerTexte(phone, `Ravi de vous rencontrer ${text} ! 👋\n\nQuel est le *Nom de votre boutique* ?`, phoneId);
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
        `Félicitations *${firstName}* ! La boutique *${shopName}* a été enregistrée. 🎉\n\n` +
        `Pour activer votre compte : Code Marchand OM / MoMo : **123456** (5 000 FCFA = 100 Reçus).`,
        phoneId
      );
    }
  }

  // 2. UTILISATEUR NON APPROUVÉ
  if (user && !user.is_approved) {
    return await envoyerTexte(phone, `Bonjour ${user.first_name} ! ⏳ Votre compte *${user.shop_name}* est en attente de validation.`, phoneId);
  }

  // 3. UTILISATEUR VALIDE
  if (user && user.is_approved) {
    const textLower = text.toLowerCase();

    // A. Choix d'un article dans le catalogue interactif
    if (interactiveId && interactiveId.startsWith('prod_')) {
      const productId = interactiveId.replace('prod_', '');
      const { data: product } = await supabase.from('products').select('*').eq('id', productId).single();

      if (product) {
        // Enregistrer le choix et passer à l'étape Quantité
        await supabase.from('conversations').upsert({
          phone_number: phone,
          step: 'SALE_QTY',
          data: { product_name: product.name, unit_price: product.price }
        });

        return await envoyerTexte(
          phone,
          `📦 Article sélectionné : *${product.name}*\n` +
          `Prix catalogue : ${product.price.toLocaleString()} FCFA\n\n` +
          `Veuillez entrer la *quantité vendue* (ex: 1, 2, 5) :`,
          phoneId
        );
      }
    }

    // B. Étape : Saisie de la Quantité
    if (conv && conv.step === 'SALE_QTY') {
      const qty = parseInt(text.replace(/[^0-9]/g, ''), 10);
      if (isNaN(qty) || qty <= 0) {
        return await envoyerTexte(phone, "⚠️ Veuillez entrer une quantité valide en chiffre (ex: 1, 2, 3).", phoneId);
      }

      const totalCalculated = conv.data.unit_price * qty;
      const updatedData = { ...conv.data, quantity: qty, calculated_total: totalCalculated };

      await supabase.from('conversations').update({
        step: 'SALE_PRICE',
        data: updatedData
      }).eq('phone_number', phone);

      return await envoyerTexte(
        phone,
        `Quantité : *${qty}*\n` +
        `Prix catalogue total : *${totalCalculated.toLocaleString()} FCFA*\n\n` +
        `Entrez le *prix final convenu* avec le client (en FCFA) :`,
        phoneId
      );
    }

    // C. Étape : Saisie du Prix Final Négocié
    if (conv && conv.step === 'SALE_PRICE') {
      const finalPrice = parseInt(text.replace(/[^0-9]/g, ''), 10);
      if (isNaN(finalPrice) || finalPrice <= 0) {
        return await envoyerTexte(phone, "⚠️ Veuillez entrer un montant valide en FCFA.", phoneId);
      }

      const updatedData = { ...conv.data, final_price: finalPrice };

      await supabase.from('conversations').update({
        step: 'SALE_CLIENT_NAME',
        data: updatedData
      }).eq('phone_number', phone);

      return await envoyerTexte(phone, "Quel est le *Nom du client* ?", phoneId);
    }

    // D. Étape : Saisie du Nom du Client & Affichage de l'Ébauche
    if (conv && conv.step === 'SALE_CLIENT_NAME') {
      const clientName = text;
      const data = conv.data;

      // Récapitulatif de l'ébauche
      const ebaucheText = 
        `🧾 *ÉBAUCHE DE REÇU B-TICKET*\n` +
        `-----------------------------------\n` +
        `🏪 *Boutique :* ${user.shop_name}\n` +
        `👤 *Client :* ${clientName}\n` +
        `📦 *Article :* ${data.product_name}\n` +
        `🔢 *Quantité :* ${data.quantity}\n` +
        `💰 *Prix Final :* ${data.final_price.toLocaleString()} FCFA\n` +
        `-----------------------------------\n\n` +
        `Ceci est une ébauche textuelle. Prochaine étape : génération de l'image officielle !`;

      // Réinitialiser la conversation
      await supabase.from('conversations').delete().eq('phone_number', phone);

      return await envoyerTexte(phone, ebaucheText, phoneId);
    }

    // C. Menu d'accueil / VENTE / Ajout au catalogue
    if (textLower === 'vente' || textLower === 'menu' || textLower === '1') {
      await ouvrirCatalogueVendeur(phone, user, phoneId);
    } else if (text.includes(',')) {
      await enregistrerArticlesCatalogue(phone, text, phoneId);
    } else {
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

// Enregistrer des articles
async function enregistrerArticlesCatalogue(phone, rawText, phoneId) {
  const lines = rawText.split('\n');
  const productsToInsert = [];

  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length >= 2) {
      const name = parts[0].trim();
      const priceStr = parts[1].replace(/[^0-9]/g, '');
      const price = parseInt(priceStr, 10);

      if (name && !isNaN(price) && price > 0) {
        productsToInsert.push({ user_phone: phone, name: name, price: price });
      }
    }
  }

  if (productsToInsert.length > 0) {
    const { error } = await supabase.from('products').insert(productsToInsert);
    if (error) {
      return await envoyerTexte(phone, `❌ Erreur Supabase : ${error.message}`, phoneId);
    }

    let msg = `✅ *${productsToInsert.length} article(s) ajouté(s) !*\n\n`;
    productsToInsert.forEach(p => { msg += `• *${p.name}* : ${p.price.toLocaleString()} FCFA\n`; });
    msg += `\nEnvoyez *VENTE* pour voir votre catalogue mis à jour !`;
    await envoyerTexte(phone, msg, phoneId);
  } else {
    await envoyerTexte(phone, `⚠️ Format invalide. Exemple : _Chaussures, 15000_`, phoneId);
  }
}

// Ouvrir catalogue
async function ouvrirCatalogueVendeur(phone, user, phoneId) {
  let { data: products } = await supabase.from('products').select('*').eq('user_phone', phone);

  if (!products || products.length === 0) {
    return await envoyerTexte(phone, `Votre catalogue est vide. Envoyez vos articles au format :\n*Nom, Prix*`, phoneId);
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
app.listen(PORT, () => { console.log(`B-Ticket Bot actif sur le port ${PORT}`); });
