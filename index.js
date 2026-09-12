const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { createCanvas } = require('@napi-rs/canvas');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const META_TOKEN = process.env.META_ACCESS_TOKEN;

app.get('/privacy', (req, res) => {
  res.send('<h1>Politique de Confidentialité - B-Ticket</h1><p>B-Ticket génère vos reçus de vente sur WhatsApp.</p>');
});

app.get('/webhook', (req, res) => {
  const verify_token = process.env.WEBHOOK_VERIFY_TOKEN || 'bticket_secret_token_2026';
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === verify_token) {
    return res.status(200).set('Content-Type', 'text/plain').send(req.query['hub.challenge']);
  }
  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    const value = body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    const phoneNumberId = value?.metadata?.phone_number_id || '1279459025258537';

    if (message) {
      const from = message.from;
      let userText = '';
      let interactiveId = null;

      if (message.type === 'text') {
        userText = message.text.body.trim();
      } else if (message.type === 'interactive') {
        if (message.interactive.list_reply) {
          interactiveId = message.interactive.list_reply.id;
          userText = message.interactive.list_reply.title;
        } else if (message.interactive.button_reply) {
          interactiveId = message.interactive.button_reply.id;
          userText = message.interactive.button_reply.title;
        }
      }

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

  // 1. ONBOARDING
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
      await supabase.from('users').insert([{ phone_number: phone, first_name: conv.data.first_name, shop_name: text, receipt_quota: 0, is_approved: false }]);
      await supabase.from('conversations').delete().eq('phone_number', phone);
      return await envoyerTexte(phone, `Félicitations ! La boutique *${text}* a été enregistrée. 🎉\n\nActivez votre compte par OM/MoMo Code Marchand : **123456**.`, phoneId);
    }
  }

  // 2. EN ATTENTE DE VALIDATION
  if (user && !user.is_approved) {
    return await envoyerTexte(phone, `Bonjour ${user.first_name} ! ⏳ Votre compte *${user.shop_name}* est en attente de validation.`, phoneId);
  }

  // 3. UTILISATEUR ACTIF
  if (user && user.is_approved) {
    const textLower = text.toLowerCase();

    // A. Action de relance ou réinitialisation
    if (interactiveId === 'btn_add_more') {
      return await ouvrirCatalogueVendeur(phone, user, phoneId);
    }

    if (interactiveId === 'btn_finish_cart') {
      await supabase.from('conversations').update({ step: 'SALE_CLIENT_NAME' }).eq('phone_number', phone);
      return await envoyerTexte(phone, "Quel est le *Nom du client* ?", phoneId);
    }

    if (interactiveId === 'btn_cancel_sale') {
      await supabase.from('conversations').delete().eq('phone_number', phone);
      return await envoyerTexte(phone, "❌ Vente annulée. Envoyez *VENTE* pour recommencer.", phoneId);
    }

    if (interactiveId === 'btn_validate_recu') {
      if (conv && conv.data) {
        const clientName = conv.data.client_name;
        const items = conv.data.items || [];
        
        await supabase.from('conversations').delete().eq('phone_number', phone);
        await envoyerTexte(phone, "⏳ Génération de votre reçu officiel B-Ticket en cours...", phoneId);
        await genererEtEnvoyerRecu(phone, user, items, clientName, phoneId);
      }
      return;
    }

    // B. Sélection d'un article dans le catalogue
    if (interactiveId && interactiveId.startsWith('prod_')) {
      const productId = interactiveId.replace('prod_', '');
      const { data: product } = await supabase.from('products').select('*').eq('id', productId).single();

      if (product) {
        const currentItems = conv?.data?.items || [];
        await supabase.from('conversations').upsert({
          phone_number: phone,
          step: 'SALE_QTY',
          data: { items: currentItems, current_product: { name: product.name, unit_price: product.price } }
        });
        return await envoyerTexte(phone, `📦 Article : *${product.name}*\nPrix catalogue : ${product.price.toLocaleString('fr-FR')} FCFA\n\nEntrez la *quantité vendue* (ex: 1, 2) :`, phoneId);
      }
    }

    // C. Saisie Quantité
    if (conv && conv.step === 'SALE_QTY') {
      const qty = parseInt(text.replace(/[^0-9]/g, ''), 10);
      if (isNaN(qty) || qty <= 0) return await envoyerTexte(phone, "⚠️ Entrez une quantité valide.", phoneId);

      const currentProduct = conv.data.current_product;
      
      await supabase.from('conversations').update({
        step: 'SALE_PRICE',
        data: { ...conv.data, current_qty: qty }
      }).eq('phone_number', phone);

      return await envoyerTexte(phone, `Quantité : *${qty}*\n\nEntrez le *prix final total convenu* pour cet article (en FCFA) :`, phoneId);
    }

    // D. Saisie Prix Final de cet article
    if (conv && conv.step === 'SALE_PRICE') {
      const finalPrice = parseInt(text.replace(/[^0-9]/g, ''), 10);
      if (isNaN(finalPrice) || finalPrice <= 0) return await envoyerTexte(phone, "⚠️ Entrez un montant valide en FCFA.", phoneId);

      const items = conv.data.items || [];
      items.push({
        name: conv.data.current_product.name,
        qty: conv.data.current_qty,
        total_price: finalPrice
      });

      await supabase.from('conversations').update({
        step: 'CART_MENU',
        data: { items: items }
      }).eq('phone_number', phone);

      // Proposer d'ajouter un autre produit ou terminer
      return await envoyerBoutonsCart(phone, items, phoneId);
    }

    // E. Saisie du Nom du Client & Affichage de l'Ébauche
    if (conv && conv.step === 'SALE_CLIENT_NAME') {
      const clientName = text;
      const items = conv.data.items || [];

      let totalVente = 0;
      let recapText = `🧾 *ÉBAUCHE DU REÇU B-TICKET*\n`;
      recapText += `-----------------------------------\n`;
      recapText += `🏪 *Boutique :* ${user.shop_name}\n`;
      recapText += `👤 *Client :* ${clientName}\n\n`;
      recapText += `*ARTICLES :*\n`;

      items.forEach((item, index) => {
        totalVente += item.total_price;
        recapText += `${index + 1}. *${item.name}* (x${item.qty}) - ${item.total_price.toLocaleString('fr-FR')} FCFA\n`;
      });

      recapText += `-----------------------------------\n`;
      recapText += `💰 *TOTAL FINAL : ${totalVente.toLocaleString('fr-FR')} FCFA*\n\n`;
      recapText += `Veuillez vérifier les informations ci-dessus avant de générer l'image du reçu.`;

      await supabase.from('conversations').update({
        step: 'VALIDE_EBAUCHE',
        data: { items: items, client_name: clientName }
      }).eq('phone_number', phone);

      await envoyerTexte(phone, recapText, phoneId);
      return await envoyerBoutonsValidation(phone, phoneId);
    }

    // Menu général
    if (textLower === 'vente' || textLower === 'menu' || textLower === '1') {
      // Nouvelle vente : on réinitialise la conversation
      await supabase.from('conversations').delete().eq('phone_number', phone);
      await ouvrirCatalogueVendeur(phone, user, phoneId);
    } else if (text.includes(',')) {
      await enregistrerArticlesCatalogue(phone, text, phoneId);
    } else {
      await envoyerTexte(phone, `Bonjour *${user.first_name}* (${user.shop_name}) !\nSolde : *${user.receipt_quota} reçus*\n\nEnvoyez *VENTE* pour émettre un reçu.`, phoneId);
    }
  }
}

// GENERATION IMAGE REÇU MULTI-ARTICLES (CHARTE B-TICKET)
async function genererEtEnvoyerRecu(phone, user, items, clientName, phoneId) {
  try {
    const baseHeight = 650;
    const itemHeight = 40;
    const height = baseHeight + (items.length * itemHeight);
    const width = 600;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const papierTicket = '#FBF6EC';
    const encreMarche = '#015E54';
    const ambreVif = '#F2A63A';
    const encreDouce = '#4B6660';

    // 1. Fond Papier
    ctx.fillStyle = papierTicket;
    ctx.fillRect(0, 0, width, height);

    // 2. En-tête Badge
    ctx.fillStyle = encreMarche;
    ctx.fillRect(40, 40, width - 80, 100);

    ctx.fillStyle = papierTicket;
    ctx.beginPath();
    ctx.arc(40, 90, 15, 0, Math.PI * 2);
    ctx.arc(width - 40, 90, 15, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = papierTicket;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(115, 50);
    ctx.lineTo(115, 130);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = papierTicket;
    ctx.font = 'bold 38px sans-serif';
    ctx.fillText('B', 70, 102);
    ctx.fillText('Ticket', 130, 102);

    // 3. Infos Boutique
    const receiptNum = `#${Math.floor(1000 + Math.random() * 9000)}`;
    const dateStr = new Date().toLocaleDateString('fr-FR');

    ctx.fillStyle = encreMarche;
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(user.shop_name.toUpperCase(), 50, 190);

    ctx.fillStyle = encreDouce;
    ctx.font = '18px monospace';
    ctx.fillText(`N° ${receiptNum}  |  Date: ${dateStr}`, 50, 220);

    ctx.strokeStyle = encreDouce;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(50, 250);
    ctx.lineTo(width - 50, 250);
    ctx.stroke();

    // 4. Details Client
    ctx.fillStyle = encreDouce;
    ctx.font = '16px sans-serif';
    ctx.fillText('CLIENT:', 50, 290);
    ctx.fillStyle = encreMarche;
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(clientName, 130, 290);

    // Tableau Articles
    let currentY = 350;
    ctx.fillStyle = encreDouce;
    ctx.font = '16px sans-serif';
    ctx.fillText('ARTICLE', 50, currentY);
    ctx.fillText('QTY', 380, currentY);
    ctx.fillText('P.U', 480, currentY);

    let totalGlobal = 0;
    currentY += 35;

    items.forEach(item => {
      const unitPrice = Math.round(item.total_price / item.qty);
      totalGlobal += item.total_price;

      ctx.fillStyle = encreMarche;
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(item.name.substring(0, 22), 50, currentY);

      ctx.font = '18px monospace';
      ctx.fillText(`${item.qty}`, 380, currentY);
      ctx.fillText(`${unitPrice.toLocaleString('fr-FR')}`, 480, currentY);

      currentY += itemHeight;
    });

    // 5. Encadré TOTAL
    currentY += 20;
    ctx.fillStyle = ambreVif;
    ctx.fillRect(50, currentY, width - 100, 90);

    ctx.fillStyle = encreMarche;
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('TOTAL PAYÉ', 80, currentY + 52);

    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${totalGlobal.toLocaleString('fr-FR')} FCFA`, width - 80, currentY + 52);

    ctx.textAlign = 'left';

    // 6. Pied de page
    ctx.fillStyle = encreDouce;
    ctx.font = '14px sans-serif';
    ctx.fillText('Merci pour votre confiance !', 200, currentY + 140);
    ctx.font = '12px sans-serif';
    ctx.fillText('Fait avec B-Ticket • Un produit Brainiacs', 180, currentY + 180);

    // Buffer & Envoi
    const imageBuffer = canvas.toBuffer('image/png');
    const FormData = require('form-data');
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', imageBuffer, { filename: 'recu.png', contentType: 'image/png' });

    const mediaRes = await axios.post(
      `https://graph.facebook.com/v20.0/${phoneId}/media`,
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${META_TOKEN}` } }
    );

    await axios.post(
      `https://graph.facebook.com/v20.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'image',
        image: { id: mediaRes.data.id, caption: `Voici le reçu pour *${clientName}* ! Prêt à être transféré. 🧾` }
      },
      { headers: { Authorization: `Bearer ${META_TOKEN}` } }
    );

    // Décompte Quota
    await supabase.from('users').update({ receipt_quota: user.receipt_quota - 1 }).eq('phone_number', phone);

  } catch (error) {
    console.error("[ERREUR GENERATION RECU]:", error.response?.data || error.message);
    await envoyerTexte(phone, "❌ Erreur lors de la création de l'image du reçu.", phoneId);
  }
}

// Helper : Boutons de gestion du panier
async function envoyerBoutonsCart(to, items, phoneId) {
  let text = `🛒 *Panier actuel (${items.length} article(s)) :*\n`;
  items.forEach((item, index) => {
    text += `• ${item.name} (x${item.qty}) : ${item.total_price.toLocaleString('fr-FR')} FCFA\n`;
  });
  text += `\nQue souhaitez-vous faire ?`;

  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: text },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'btn_add_more', title: '➕ Ajouter article' } },
              { type: 'reply', reply: { id: 'btn_finish_cart', title: '✅ Terminer & Valider' } }
            ]
          }
        }
      },
      { headers: { Authorization: `Bearer ${META_TOKEN}` } }
    );
  } catch (error) {
    console.error("[ERREUR BOUTONS CART]:", error.response?.data || error.message);
  }
}

// Helper : Boutons de validation de l'ébauche
async function envoyerBoutonsValidation(to, phoneId) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: "Confirmez-vous l'émission du reçu ?" },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'btn_validate_recu', title: '🚀 Générer Reçu' } },
              { type: 'reply', reply: { id: 'btn_cancel_sale', title: '✏️ Annuler / Modifier' } }
            ]
          }
        }
      },
      { headers: { Authorization: `Bearer ${META_TOKEN}` } }
    );
  } catch (error) {
    console.error("[ERREUR BOUTONS VALIDATION]:", error.response?.data || error.message);
  }
}

// Helpers génériques
async function enregistrerArticlesCatalogue(phone, rawText, phoneId) {
  const lines = rawText.split('\n');
  const productsToInsert = [];
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length >= 2) {
      const name = parts[0].trim();
      const price = parseInt(parts[1].replace(/[^0-9]/g, ''), 10);
      if (name && !isNaN(price) && price > 0) productsToInsert.push({ user_phone: phone, name, price });
    }
  }
  if (productsToInsert.length > 0) {
    await supabase.from('products').insert(productsToInsert);
    await envoyerTexte(phone, `✅ *${productsToInsert.length} article(s) ajouté(s) !*`, phoneId);
  }
}

async function ouvrirCatalogueVendeur(phone, user, phoneId) {
  let { data: products } = await supabase.from('products').select('*').eq('user_phone', phone);
  if (!products || products.length === 0) return await envoyerTexte(phone, `Votre catalogue est vide. Envoyez au format :\n*Nom, Prix*`, phoneId);

  const rows = products.slice(0, 10).map(p => ({
    id: `prod_${p.id}`,
    title: p.name.substring(0, 24),
    description: `${p.price.toLocaleString('fr-FR')} FCFA`
  }));

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
        action: { button: 'Voir le catalogue', sections: [{ title: 'Articles', rows }] }
      }
    },
    { headers: { Authorization: `Bearer ${META_TOKEN}` } }
  );
}

async function envoyerTexte(to, text, phoneId) {
  await axios.post(
    `https://graph.facebook.com/v20.0/${phoneId}/messages`,
    { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
    { headers: { Authorization: `Bearer ${META_TOKEN}` } }
  );
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`B-Ticket Bot actif sur le port ${PORT}`); });
    
