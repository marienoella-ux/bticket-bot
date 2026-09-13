const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');
const { createCanvas } = require('@napi-rs/canvas');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Interception du body brut (raw) pour la vérification HMAC de Meta
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// --- VARIABLES D'ENVIRONNEMENT ---
const PORT = process.env.PORT || 3000;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const APP_SECRET = process.env.APP_SECRET;
const ADMIN_PHONE = process.env.ADMIN_PHONE ? process.env.ADMIN_PHONE.replace(/[^0-9]/g, '') : '';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// --- INITIALISATION SUPABASE ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// SYSTEME DE TRADUCTIONS ET HELPERS MULTI-LANGUES
// ==========================================

const translations = {
  fr: {
    lang_changed: "Langue changée en Français 🇫🇷",
    welcome: "Bienvenue {name} ! 👋 Choisissez une option ci-dessous ou envoyez un message au format Express (ex: Produit, 2, 5000).",
    express_prompt: "💡 *Mode Express* : Envoyez directement vos articles au format :\n`Nom du produit, Quantité, Prix total`\n\nExemple :\n*Sac de riz, 2, 30000*",
    quota_warning: "⚠️ {name}, votre solde de reçus est épuisé (0 restant). Veuillez recharger votre compte.",
    btn_catalog: "📦 Mon catalogue",
    btn_sales: "📊 Mes ventes",
    btn_help: "❓ Aide",
    welcome_new: "👋 Bienvenue sur B-Ticket Express {name}!\n\nVotre compte est en cours d'activation par notre équipe administrative. Vous recevrez une notification très rapidement.",
    congrats_approved: "🎉 Félicitations {name}! Votre compte B-Ticket a été approuvé avec un quota de {quota} reçus.",
    recharge_success: "{name} 🎁 Votre compte a été rechargé de {quota} reçus ! Nouveau solde : {total} reçus."
  },
  en: {
    lang_changed: "Language changed to English 🇬🇧",
    welcome: "Welcome {name}! 👋 Choose an option below or send a message in Express format (e.g., Product, 2, 5000).",
    express_prompt: "💡 *Express Mode*: Send your items directly using the format:\n`Product name, Quantity, Total price`\n\nExample:\n*Bag of rice, 2, 30000*",
    quota_warning: "⚠️ {name}, your receipt quota is exhausted (0 remaining). Please top up your account.",
    btn_catalog: "📦 My catalog",
    btn_sales: "📊 My sales",
    btn_help: "❓ Help",
    welcome_new: "👋 Welcome to B-Ticket Express {name}!\n\nYour account is being activated by our team. You will receive a notification shortly.",
    congrats_approved: "🎉 Congratulations {name}! Your B-Ticket account has been approved with a quota of {quota} receipts.",
    recharge_success: "{name} 🎁 Your account has been topped up with {quota} receipts! New balance: {total} receipts."
  }
};

// Helper de traduction amélioré avec gestion du prénom
function t(user, key) {
  const lang = (user && user.language) ? user.language : 'fr';
  let text = translations[lang]?.[key] || translations['fr']?.[key] || key;
  
  // Extraire le prénom correctement
  const firstName = user?.first_name || user?.full_name?.split(' ')[0] || user?.shop_name || '';
  
  // Remplacer {name} par le prénom
  return text.replace('{name}', firstName).replace(/\s+/g, ' ');
}

// ==========================================
// MIDDLEWARE DE SÉCURITÉ WEBHOOK (HMAC-SHA256)
// ==========================================
function verifierSignatureMeta(req, res, next) {
  if (!APP_SECRET) {
    return next();
  }

  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    console.warn("⚠️ Requête Webhook rejetée : Signature manquante.");
    return res.status(401).send("Signature manquante");
  }

  const elements = signature.split('=');
  const signatureHash = elements[1];

  const expectedHash = crypto
    .createHmac('sha256', APP_SECRET)
    .update(req.rawBody)
    .digest('hex');

  if (signatureHash !== expectedHash) {
    console.warn("❌ Requête Webhook rejetée : Signature invalide.");
    return res.status(403).send("Signature invalide");
  }

  next();
}

// ==========================================
// FONCTIONS HELPERS / WHATSAPP API
// ==========================================

// 1. Envoyer un message texte simple
async function envoyerTexte(to, text, phoneId) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    console.error("Erreur envoyerTexte:", err.response ? err.response.data : err.message);
  }
}

// 2. Envoyer les boutons de validation du panier
async function envoyerBoutonsCart(phone, items, phoneId) {
  let recap = `🛒 *VOTRE PANIER ACTUEL (${items.length} article(s)) :*\n\n`;
  let total = 0;
  items.forEach((item, index) => {
    recap += `${index + 1}. *${item.name}* (x${item.qty}) - ${item.total_price.toLocaleString('fr-FR')} FCFA\n`;
    total += item.total_price;
  });
  recap += `\n💰 *Total temporaire :* ${total.toLocaleString('fr-FR')} FCFA`;

  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: recap },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'btn_add_more', title: '➕ Ajouter article' } },
              { type: 'reply', reply: { id: 'btn_finish_cart', title: '✅ Valider reçu' } },
              { type: 'reply', reply: { id: 'btn_cancel_sale', title: '❌ Annuler' } }
            ]
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    console.error("Erreur envoyerBoutonsCart:", err.response ? err.response.data : err.message);
  }
}

// 3. Ouvrir le catalogue interactif du vendeur
async function ouvrirCatalogueVendeur(phone, user, phoneId) {
  const { data: products } = await supabase.from('products').select('*').limit(10);

  if (!products || products.length === 0) {
    const noProdMsg = t(user, 'welcome') + "\nAucun produit configuré dans votre catalogue.\n\n" +
      "⚡ Vous pouvez directement utiliser le *Mode Express* en envoyant :\n" +
      "`Nom Produit, Quantité, Prix Total`";
    return await envoyerTexte(phone, noProdMsg, phoneId);
  }

  const rows = products.map(p => ({
    id: `prod_${p.id}`,
    title: p.name.substring(0, 24),
    description: `${p.price ? p.price.toLocaleString('fr-FR') + ' FCFA' : 'Prix flexible'}`
  }));

  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: '🛍️ CATALOGUE B-TICKET' },
          body: { text: 'Sélectionnez un article à ajouter au reçu :' },
          footer: { text: 'B-Ticket Express' },
          action: {
            button: 'Choisir un produit',
            sections: [{ title: 'Produits disponibles', rows: rows }]
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    console.error("Erreur ouvrirCatalogueVendeur:", err.response ? err.response.data : err.message);
  }
}

// 4. Demander le nom du client
async function envoyerDemandeClient(phone, phoneId) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: "👤 *À quel nom souhaitez-vous émettre le reçu ?*\n\nRépondez directement avec le nom du client (ex: *Mme Alice*), ou cliquez sur le bouton ci-dessous pour un client anonyme." },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'btn_client_default', title: '👤 Client Comptoir' } }
            ]
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    console.error("Erreur envoyerDemandeClient:", err.response ? err.response.data : err.message);
  }
}

// 5. Afficher le récapitulatif avant impression finale
async function afficherRecuEbauche(phone, user, items, clientName, phoneId) {
  let recap = `🧾 *RÉCAPITULATIF DE LA VENTE*\n`;
  recap += `🏪 Boutique : *${user.shop_name}*\n`;
  recap += `👤 Client : *${clientName}*\n`;
  recap += `-----------------------------------\n`;

  let total = 0;
  items.forEach((item, i) => {
    recap += `${i + 1}. *${item.name}* (x${item.qty}) : ${item.total_price.toLocaleString('fr-FR')} FCFA\n`;
    total += item.total_price;
  });

  recap += `-----------------------------------\n`;
  recap += `💰 *TOTAL À PAYER : ${total.toLocaleString('fr-FR')} FCFA*\n\n`;
  recap += `Confirmez-vous la génération du reçu ? (Quota restant : ${user.receipt_quota} reçus)`;

  await supabase.from('conversations').upsert({
    phone_number: phone,
    step: 'CONFIRM_SALE',
    data: { items: items, client_name: clientName }
  });

  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: recap },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'btn_validate_recu', title: '📄 Générer le Reçu' } },
              { type: 'reply', reply: { id: 'btn_cancel_sale', title: '❌ Annuler' } }
            ]
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    console.error("Erreur afficherRecuEbauche:", err.response ? err.response.data : err.message);
  }
}

// 6. Uploader l'image vers Meta WhatsApp Media
async function uploaderMediaWhatsApp(imageBuffer, mimeType, phoneId) {
  try {
    const form = new FormData();
    form.append('file', imageBuffer, { filename: 'recu.png', contentType: mimeType });
    form.append('type', 'image');
    form.append('messaging_product', 'whatsapp');

    const res = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneId}/media`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${META_ACCESS_TOKEN}`
        }
      }
    );
    return res;
  } catch (err) {
    console.error("Erreur uploaderMediaWhatsApp:", err.response ? err.response.data : err.message);
    return null;
  }
}

// 7. Sauvegarde automatique des produits 
async function autoSaveProducts(userId, items) {
  for (const item of items) {
    const unitPrice = Math.round(item.total_price / item.qty);
    const { data: existing } = await supabase
      .from('products')
      .select('id')
      .eq('user_id', userId)
      .ilike('name', item.name.trim())
      .maybeSingle();

    if (!existing) {
      await supabase
        .from('products')
        .insert({
          user_id: userId,
          name: item.name.trim(),
          price: unitPrice
        });
    }
  }
}

// 8. GENERATION ET ENVOI DE L'IMAGE REÇU
async function genererEtEnvoyerRecu(phone, user, items, clientName, phoneId) {
  try {
    const totalAmount = items.reduce((sum, item) => sum + item.total_price, 0);

    const { data: sale } = await supabase
      .from('sales')
      .insert([
        {
          user_id: user.id,
          client_name: clientName,
          total_amount: totalAmount,
          items: items
        }
      ])
      .select()
      .single();

    const saleId = sale ? sale.id : Date.now().toString().slice(-6);

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

    ctx.fillStyle = papierTicket;
    ctx.fillRect(0, 0, width, height);

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

    const receiptNum = `#BT-${saleId}`;
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

    ctx.fillStyle = encreDouce;
    ctx.font = '16px sans-serif';
    ctx.fillText('CLIENT:', 50, 290);
    ctx.fillStyle = encreMarche;
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(clientName, 130, 290);

    let currentY = 350;
    ctx.fillStyle = encreDouce;
    ctx.font = '16px sans-serif';
    ctx.fillText('ARTICLE', 50, currentY);
    ctx.fillText('QTY', 380, currentY);
    ctx.fillText('P.U', 480, currentY);

    currentY += 35;

    items.forEach(item => {
      const unitPrice = Math.round(item.total_price / item.qty);

      ctx.fillStyle = encreMarche;
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(item.name.substring(0, 22), 50, currentY);

      ctx.font = '18px monospace';
      ctx.fillText(`${item.qty}`, 380, currentY);
      ctx.fillText(`${unitPrice.toLocaleString('fr-FR')}`, 480, currentY);

      currentY += itemHeight;
    });

    currentY += 20;
    ctx.fillStyle = ambreVif;
    ctx.fillRect(50, currentY, width - 100, 90);

    ctx.fillStyle = encreMarche;
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('TOTAL PAYÉ', 80, currentY + 52);

    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${totalAmount.toLocaleString('fr-FR')} FCFA`, width - 80, currentY + 52);

    ctx.textAlign = 'left';

    ctx.fillStyle = encreDouce;
    ctx.font = '14px sans-serif';
    ctx.fillText('Merci pour votre confiance !', 200, currentY + 140);
    ctx.font = '12px sans-serif';
    ctx.fillText('Fait avec B-Ticket • Un produit Brainiacs', 180, currentY + 180);

    const imageBuffer = canvas.toBuffer('image/png');

    const newQuota = user.receipt_quota - 1;

    const { error: updateError } = await supabase
      .from('users')
      .update({ receipt_quota: newQuota })
      .eq('id', user.id);

    if (!updateError) {
      user.receipt_quota = newQuota;
    }
    
    const mediaRes = await uploaderMediaWhatsApp(imageBuffer, 'image/png', phoneId);

    if (mediaRes && mediaRes.data && mediaRes.data.id) {
      await axios.post(
        `https://graph.facebook.com/v18.0/${phoneId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phone,
          type: 'image',
          image: {
            id: mediaRes.data.id,
            caption: `Voici le reçu pour *${clientName}* ! Prêt à être transféré. 🧾\nSolde restant : *${newQuota} reçus*`
          }
        },
        { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` } }
      );
    } else {
      await envoyerTexte(phone, "⚠️ Erreur lors de l'envoi de l'image du reçu sur WhatsApp.", phoneId);
    }

  } catch (error) {
    console.error("[ERREUR GENERATION RECU]:", error.response?.data || error.message);
    await envoyerTexte(phone, "❌ Erreur lors de la création de l'image du reçu.", phoneId);
  }
}

// ==========================================
// ROUTER DE CONVERSATION ET GESTION DU BOT
// ==========================================

async function traiterMessageEntrant(phone, text, interactiveId, phoneId) {
  const textUpper = text ? text.toUpperCase().trim() : '';

  // ------------------------------------------
  // MODULE ADMINISTRATEUR
  // ------------------------------------------
  if (phone === ADMIN_PHONE) {
    if (textUpper === 'ADMIN' || textUpper === 'DASHBOARD') {
      const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
      const { count: pendingUsers } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_approved', false);
      const { count: totalProducts } = await supabase.from('products').select('*', { count: 'exact', head: true });

      const adminMsg = 
        `📊 *TABLEAU DE BORD ADMIN B-TICKET*\n` +
        `-----------------------------------\n` +
        `👥 *Commerçants inscrits :* ${totalUsers || 0}\n` +
        `⏳ *En attente de validation :* ${pendingUsers || 0}\n` +
        `📦 *Articles au catalogue :* ${totalProducts || 0}\n\n` +
        `*COMMANDES DISPONIBLES :*\n` +
        `• *ATTENTE* : Voir les comptes non approuvés.\n` +
        `• *VALIDER <numéro> <quota>* : Approuver un compte.\n` +
        `• *RECHARGE <numéro> <quota>* : Ajouter des reçus.`;

      return await envoyerTexte(phone, adminMsg, phoneId);
    }

    if (textUpper === 'ATTENTE') {
      const { data: pending } = await supabase.from('users').select('*').eq('is_approved', false);
      if (!pending || pending.length === 0) {
        return await envoyerTexte(phone, "✅ Aucun compte en attente de validation.", phoneId);
      }
      let listMsg = "⏳ *COMPTES EN ATTENTE :*\n\n";
      pending.forEach(u => {
        listMsg += `• Nom: ${u.shop_name} | Num: ${u.phone_number}\n`;
      });
      listMsg += "\nPour valider : `VALIDER <numéro> <quota>`";
      return await envoyerTexte(phone, listMsg, phoneId);
    }

    if (textUpper.startsWith('VALIDER')) {
      const parts = text.split(' ');
      if (parts.length >= 3) {
        const targetPhone = parts[1].replace(/[^0-9]/g, '');
        const quota = parseInt(parts[2], 10);
        if (!isNaN(quota)) {
          await supabase.from('users').update({ is_approved: true, receipt_quota: quota }).eq('phone_number', targetPhone);
          const { data: targetUser } = await supabase.from('users').select('*').eq('phone_number', targetPhone).single();
          const approvedText = t(targetUser, 'congrats_approved').replace('{quota}', quota);
          await envoyerTexte(targetPhone, approvedText, phoneId);
          return await envoyerTexte(phone, `✅ Compte ${targetPhone} approuvé avec ${quota} reçus.`, phoneId);
        }
      }
    }

    if (textUpper.startsWith('RECHARGE')) {
      const parts = text.split(' ');
      if (parts.length >= 3) {
        const targetPhone = parts[1].replace(/[^0-9]/g, '');
        const addQuota = parseInt(parts[2], 10);
        if (!isNaN(addQuota)) {
          const { data: u } = await supabase.from('users').select('*').eq('phone_number', targetPhone).single();
          if (u) {
            const newQ = (u.receipt_quota || 0) + addQuota;
            await supabase.from('users').update({ receipt_quota: newQ }).eq('phone_number', targetPhone);
            const rechargeText = t(u, 'recharge_success').replace('{quota}', addQuota).replace('{total}', newQ);
            await envoyerTexte(targetPhone, rechargeText, phoneId);
            return await envoyerTexte(phone, `✅ Recharge effectuée pour ${targetPhone}. Nouveau total : ${newQ}`, phoneId);
          }
        }
      }
    }
  }

  // ------------------------------------------
  // CHARGEMENT PROFIL UTILISATEUR
  // ------------------------------------------
  let { data: user } = await supabase.from('users').select('*').eq('phone_number', phone).single();

  if (!user) {
    const { data: newUser } = await supabase.from('users').insert([{ phone_number: phone, shop_name: 'Ma Boutique', is_approved: false, receipt_quota: 5 }]).select().single();
    return await envoyerTexte(phone, t(newUser || { phone_number: phone }, 'welcome_new'), phoneId);
  }

  if (!user.is_approved) {
    return await envoyerTexte(phone, "⏳ Votre compte est en attente d'approbation par l'administrateur. Merci de patienter !", phoneId);
  }

  // RÉCUPÉRATION DE L'ÉTAT DE LA CONVERSATION
  const { data: conv } = await supabase.from('conversations').select('*').eq('phone_number', phone).single();

  // ------------------------------------------
  // CLIC SUR LES BOUTONS INTERACTIFS
  // ------------------------------------------
  if (interactiveId) {
    if (interactiveId === 'btn_validate_recu') {
      if (conv && conv.step === 'CONFIRM_SALE') {
        const { items, client_name } = conv.data;
        await supabase.from('conversations').delete().eq('phone_number', phone);
        return await genererEtEnvoyerRecu(phone, user, items, client_name, phoneId);
      }
    }

    if (interactiveId === 'btn_cancel_sale') {
      await supabase.from('conversations').delete().eq('phone_number', phone);
      return await envoyerTexte(phone, "❌ Vente annulée.", phoneId);
    }

    if (interactiveId === 'btn_client_default') {
      if (conv && conv.step === 'ASK_CLIENT_NAME') {
        const items = conv.data.items;
        return await afficherRecuEbauche(phone, user, items, 'Client Comptoir', phoneId);
      }
    }

    if (interactiveId === 'btn_add_more') {
      await supabase.from('conversations').upsert({ phone_number: phone, step: 'BUILDING_CART', data: conv ? conv.data : { items: [] } });
      return await ouvrirCatalogueVendeur(phone, user, phoneId);
    }

    if (interactiveId === 'btn_finish_cart') {
      if (conv && conv.data && conv.data.items && conv.data.items.length > 0) {
        await supabase.from('conversations').upsert({ phone_number: phone, step: 'ASK_CLIENT_NAME', data: conv.data });
        return await envoyerDemandeClient(phone, phoneId);
      }
    }

    if (interactiveId.startsWith('prod_')) {
      const prodId = interactiveId.replace('prod_', '');
      const { data: prod } = await supabase.from('products').select('*').eq('id', prodId).single();

      if (prod) {
        const currentItems = (conv && conv.data && conv.data.items) ? conv.data.items : [];
        currentItems.push({ name: prod.name, qty: 1, total_price: prod.price || 0 });

        await supabase.from('conversations').upsert({
          phone_number: phone,
          step: 'CART_ACTIVE',
          data: { items: currentItems }
        });

        return await envoyerBoutonsCart(phone, currentItems, phoneId);
      }
    }
  }

  // --------------------------------------
  // COMMANDE POUR CHANGER DE LANGUE
  // ---------------------------------------
  if (text && (text.toLowerCase() === '/lang' || text.toLowerCase() === 'langue')) {
    const newLang = user.language === 'en' ? 'fr' : 'en';
    await supabase.from('users').update({ language: newLang }).eq('id', user.id);
    user.language = newLang;
    return await envoyerTexte(phone, t(user, 'lang_changed'), phoneId);
  }

  // ------------------------------------------
  // GESTION DU MODE EXPRESS MULTI-ARTICLES (SÉPARATEUR VIRGULE)
  // ------------------------------------------
  if (text && text.includes(',')) {
    if (conv && conv.step !== 'CONFIRM_SALE') {
      await supabase.from('conversations').delete().eq('phone_number', phone);
    }

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const items = [];
    let clientName = 'Client Comptoir';

    for (const line of lines) {
      if (line.toLowerCase().startsWith('client:')) {
        clientName = line.substring(7).trim() || 'Client Comptoir';
        continue;
      }

      const parts = line.split(',').map(p => p.trim());
      if (parts.length >= 3) {
        const prodName = parts[0];
        const qty = parseInt(parts[1].replace(/[^0-9]/g, ''), 10);
        const totalPrice = parseInt(parts[2].replace(/[^0-9]/g, ''), 10);

        if (prodName && !isNaN(qty) && !isNaN(totalPrice) && qty > 0 && totalPrice > 0) {
          items.push({ name: prodName, qty: qty, total_price: totalPrice });
        }
      }
    }

    if (items.length > 0) {
      if (user.receipt_quota <= 0) {
        return await envoyerTexte(phone, t(user, 'quota_warning'), phoneId);
      }
      await autoSaveProducts(user.id, items);
      return await afficherRecuEbauche(phone, user, items, clientName, phoneId);
    }
  }

  // ------------------------------------------
  // SAISIE DU NOM DU CLIENT DEPUIS LE MODE CLASSIQUE
  // ------------------------------------------
  if (conv && conv.step === 'ASK_CLIENT_NAME' && text) {
    const items = conv.data.items;
    return await afficherRecuEbauche(phone, user, items, text.trim(), phoneId);
  }

  // MENU PAR DÉFAUT SI AUCUNE COMMANDE N'EST RECONNUE
  const defaultMessage = `${t(user, 'welcome')}\n\n${t(user, 'express_prompt')}`;
  return await envoyerTexte(phone, defaultMessage, phoneId);
}

// ==========================================
// ROUTES WEBHOOK META WHATSAPP
// ==========================================

// GET : Verification du Webhook
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// POST : Réception des événements WhatsApp
app.post('/webhook', verifierSignatureMeta, async (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    if (
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages &&
      body.entry[0].changes[0].value.messages[0]
    ) {
      const message = body.entry[0].changes[0].value.messages[0];
      const phoneId = body.entry[0].changes[0].value.metadata.phone_number_id;
      const phone = message.from;

      let text = null;
      let interactiveId = null;

      if (message.type === 'text') {
        text = message.text.body;
      } else if (message.type === 'interactive') {
        if (message.interactive.type === 'button_reply') {
          interactiveId = message.interactive.button_reply.id;
        } else if (message.interactive.type === 'list_reply') {
          interactiveId = message.interactive.list_reply.id;
        }
      }

      await traiterMessageEntrant(phone, text, interactiveId, phoneId);
    }
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// START SERVER
app.listen(PORT, () => {
  console.log(`Serveur B-Ticket démarré sur le port ${PORT}`);
});
