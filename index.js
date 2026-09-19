const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { createClient } = require('@supabase/supabase-js');
const BRAINIACS_ICON_B64 = "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";
let brainiacsIconImg = null; // mis en cache après le premier chargement
const TARIF_REF_FCFA = 35;        // prix moyen pondéré par reçu, sert à convertir un montant en crédits
const QUOTA_DEFAUT_APPROBATION = 15;

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
const messagesTraites = new Set();

// ==========================================
// SYSTEME DE TRADUCTIONS ET HELPERS MULTI-LANGUES
// ==========================================

const translations = {
  fr: {
    lang_changed: "Langue changée en Français 🇫🇷",
    welcome: "Bienvenue {name} ! Choisissez une option ci-dessous ou envoyez un message au format Express (ex: Produit, 2, 5000).",
    express_prompt: "*Mode Express* : Envoyez directement vos articles au format :\n`Nom du produit, Quantité, Prix total`\n\nExemple :\n*Sac de riz, 2, 30000*",
    quota_warning: "{name}, votre solde de reçus est épuisé (0 restant). Veuillez recharger votre compte.",
    btn_catalog: "Mon catalogue",
    btn_sales: "Mes ventes",
    btn_help: "❓ Aide",
    welcome_new: "Bienvenue sur B-Ticket Express {name}!\n\nVotre compte est en cours d'activation par notre équipe administrative. Vous recevrez une notification très rapidement.",
    congrats_approved: "🎉 Félicitations {name}! Votre compte B-Ticket a été approuvé avec un quota de {quota} reçus.",
    recharge_success: "{name} Votre compte a été rechargé de {quota} reçus ! Nouveau solde : {total} reçus.",
    // Dans translations.fr, à côté de congrats_approved
    guide_usage: "📘 *Comment utiliser B-Ticket*\n\n" +
      "⚡ *Vente rapide* : `Produit, Quantité, Prix` (ex: Sac de riz, 2, 30000)\n\n" +
      "📋 *MENU* — catalogue, historique de ventes, aide\n" +
      "🖼️ *LOGO* — ajouter ton logo sur tes reçus\n" +
      "💳 *RECHARGE* — recharger ton solde de reçus\n\n" +
      "🎁 Tu reçois 15 reçus gratuits chaque 1er du mois, en plus de ton solde.",
  },
  en: {
    lang_changed: "Language changed to English 🇬🇧",
    welcome: "Welcome {name}! Choose an option below or send a message in Express format (e.g., Product, 2, 5000).",
    express_prompt: "*Express Mode*: Send your items directly using the format:\n`Product name, Quantity, Total price`\n\nExample:\n*Bag of rice, 2, 30000*",
    quota_warning: "{name}, your receipt quota is exhausted (0 remaining). Please top up your account.",
    btn_catalog: "My catalog",
    btn_sales: "My sales",
    btn_help: "❓ Help",
    welcome_new: "Welcome to B-Ticket Express {name}!\n\nYour account is being activated by our team. You will receive a notification shortly.",
    congrats_approved: "🎉 Congratulations {name}! Your B-Ticket account has been approved with a quota of {quota} receipts.",
    recharge_success: "{name} Your account has been topped up with {quota} receipts! New balance: {total} receipts."
    // In translations.fr, next to congrats_approved
    guide_usage: "📘 *How to Use B-Ticket*\n\n" +
      "⚡ *Quick Sale*: `Product, Quantity, Price` (e.g., Bag of rice, 2, 30000)\n\n" +
      "📋 *MENU* — catalog, sales history, help\n" +
      "🖼️ *LOGO* — add your logo to your receipts\n" +
      "💳 *TOP-UP* — top up your receipt balance\n\n" +
      "🎁 You receive 15 free receipts on the 1st of every month, in addition to your balance.",
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

//MENU PRINCIPAL 
async function envoyerMenuPrincipal(phone, user, phoneId) {
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
          body: { text: `Bonjour *${user.first_name}* ! Que souhaitez-vous faire ?\n\nSolde : *${user.receipt_quota} reçus*` },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'btn_menu_catalog', title: 'Mon catalogue' } },
              { type: 'reply', reply: { id: 'btn_menu_sales', title: 'Mes ventes' } },
              { type: 'reply', reply: { id: 'btn_menu_help', title: '❓ Aide' } }
            ]
          }
        }
      },
      { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error("Erreur envoyerMenuPrincipal:", err.response ? err.response.data : err.message);
  }
}

// HISTORIQUE DE VENTE
async function envoyerHistoriqueVentes(phone, user, phoneId) {
  const { data: sales, error } = await supabase
    .from('sales')
    .select('*')
    .eq('user_id', user.phone_number)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error || !sales || sales.length === 0) {
    return await envoyerTexte(phone, "Aucune vente enregistrée pour le moment.", phoneId);
  }

  let msg = `*VOS 5 DERNIÈRES VENTES*\n\n`;
  sales.forEach(s => {
    const date = new Date(s.created_at).toLocaleDateString('fr-FR');
    msg += `• ${date} — ${s.client_name} : *${s.total_amount.toLocaleString('fr-FR')} FCFA*\n`;
  });
  return await envoyerTexte(phone, msg, phoneId);
}

//AIDE
async function envoyerAide(phone, user, phoneId) {
  const msg = `❓ *AIDE B-TICKET*\n\n` +
    `*Mode Express* — envoyez directement :\n\`Produit, Quantité, Prix total\`\n_Exemple :_ Sac de riz, 2, 30000\n\n` +
    `*Menu guidé* — envoyez *MENU* pour choisir un article dans votre catalogue, consulter vos ventes, ou revoir cette aide.\n\n` +
    `Solde actuel : *${user.receipt_quota} reçus*`;
  return await envoyerTexte(phone, msg, phoneId);
}

// 2. Envoyer les boutons de validation du panier
async function envoyerBoutonsCart(phone, items, phoneId) {
  let recap = `*VOTRE PANIER ACTUEL (${items.length} article(s)) :*\n\n`;
  let total = 0;
  items.forEach((item, index) => {
    recap += `${index + 1}. *${item.name}* (x${item.qty}) - ${item.total_price.toLocaleString('fr-FR')} FCFA\n`;
    total += item.total_price;
  });
  recap += `\n*Total temporaire :* ${total.toLocaleString('fr-FR')} FCFA`;

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
  const { data: products } = await supabase.from('products').select('*').eq('user_phone', phone).limit(9);

  const rows = [{ id: 'catalog_add', title: '➕ Ajouter un article', description: 'Nouveau produit ou service' }];
  (products || []).forEach(p => rows.push({
    id: `prod_${p.id}`,
    title: p.name.substring(0, 24),
    description: p.price ? `${p.price.toLocaleString('fr-FR')} FCFA` : 'Prix flexible'
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
          header: { type: 'text', text: 'CATALOGUE B-TICKET' },
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

async function previsualiserCreditsMensuels() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const { data: users } = await supabase
    .from('users')
    .select('phone_number')
    .eq('is_approved', true)
    .or(`last_free_credit_month.is.null,last_free_credit_month.neq.${currentMonth}`);
  return { currentMonth, count: users ? users.length : 0, phones: users ? users.map(u => u.phone_number) : [] };
}

async function executerCreditsMensuels(currentMonth, phones) {
  for (const phone of phones) {
    const { data: u } = await supabase.from('users').select('receipt_quota').eq('phone_number', phone).single();
    const newQuota = (u?.receipt_quota || 0) + 15;
    await supabase.from('users').update({ receipt_quota: newQuota, last_free_credit_month: currentMonth }).eq('phone_number', phone);
  }
}

// Crédit mensuel
async function distribuerCreditsMensuels() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const { data: users, error } = await supabase
    .from('users')
    .select('phone_number, receipt_quota, last_free_credit_month')
    .eq('is_approved', true)
    .or(`last_free_credit_month.is.null,last_free_credit_month.neq.${currentMonth}`);

  if (error) {
    console.error("Erreur lecture utilisateurs pour crédit mensuel:", error);
    return;
  }
  if (!users || users.length === 0) {
    console.log("Aucun vendeur à créditer pour", currentMonth);
    return;
  }

  for (const u of users) {
    const newQuota = (u.receipt_quota || 0) + 15;
    await supabase.from('users').update({
      receipt_quota: newQuota,
      last_free_credit_month: currentMonth
    }).eq('phone_number', u.phone_number);
  }
  console.log(`✅ Crédit mensuel (+15) distribué à ${users.length} vendeur(s) pour ${currentMonth}`);
}

// 4. Demander le nom du client
async function envoyerDemandeClient(phone, user, conv, phoneId) {
  const { data: recentSales } = await supabase
    .from('sales')
    .select('client_name')
    .eq('user_id', user.phone_number)
    .neq('client_name', 'Client Comptoir')
    .order('created_at', { ascending: false })
    .limit(30);

  const frequents = [...new Set((recentSales || []).map(s => s.client_name))].slice(0, 2);

  const buttons = frequents.map((name, i) => ({
    type: 'reply',
    reply: { id: `client_recent_${i}`, title: name.substring(0, 20) }
  }));
  buttons.push({ type: 'reply', reply: { id: 'btn_client_default', title: '👤 Client Comptoir' } });

  if (frequents.length > 0) {
    await supabase.from('conversations').update({ data: { ...conv.data, frequents } }).eq('phone_number', phone);
  }


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
          body: { text: "👤 *À quel nom souhaitez-vous émettre le reçu ?*\n\nChoisissez un client récent, ou répondez directement avec un nom." },
          action: { buttons }
        }
      },
      { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error("Erreur envoyerDemandeClient:", err.response ? err.response.data : err.message);
  }
}
// 5. Afficher le récapitulatif avant impression finale
async function afficherRecuEbauche(phone, user, items, clientName, phoneId) {
  let recap = `*RÉCAPITULATIF DE LA VENTE*\n`;
  recap += `Boutique : *${user.shop_name}*\n`;
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

// UPLOAD MEDIA WHATSAPP
async function uploaderMediaWhatsApp(imageBuffer, mimeType, phoneId) {
  try {
    const form = new FormData();
    form.append('file', imageBuffer, { filename: 'recu.png', contentType: mimeType });
    form.append('type', 'image');
    form.append('messaging_product', 'whatsapp');

    const res = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneId}/media`,
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${META_ACCESS_TOKEN}` } }
    );
    return res;
  } catch (err) {
    console.error("Erreur uploaderMediaWhatsApp:", err.response ? err.response.data : err.message);
    return null;
  }
}
// 6. SAUVEGARDER LOGO
async function sauvegarderLogo(phone, imageBuffer, mimeType) {
  const ext = mimeType && mimeType.includes('png') ? 'png' : 'jpg';
  const filePath = `${phone}.${ext}`;
  const { error } = await supabase.storage.from('logos').upload(filePath, imageBuffer, {
    contentType: mimeType || 'image/jpeg',
    upsert: true
  });
  if (error) {
    console.error("Erreur upload logo:", error);
    return null;
  }
  const { data } = supabase.storage.from('logos').getPublicUrl(filePath);
  return data.publicUrl;
}

// 7. Sauvegarde automatique des produits 
async function autoSaveProducts(userId, items) {
  for (const item of items) {
    const unitPrice = Math.round(item.total_price / item.qty);
    const { data: existing } = await supabase
      .from('products')
      .select('id')
      .eq('user_phone', userId)
      .ilike('name', item.name.trim())
      .maybeSingle();

    if (!existing) {
      await supabase
        .from('products')
        .insert({
          user_phone: userId,
          name: item.name.trim(),
          price: unitPrice
        });
    }
  }
}
// LA LISTE EN ATTENTE
async function envoyerListeAttente(phone, phoneId) {
  const { data: pendingUsers } = await supabase.from('users').select('*').eq('is_approved', false).limit(5);
  const { data: pendingRecharges } = await supabase.from('recharge_requests').select('*').eq('status', 'pending').limit(5);

  if ((!pendingUsers || pendingUsers.length === 0) && (!pendingRecharges || pendingRecharges.length === 0)) {
    return await envoyerTexte(phone, "✅ Rien en attente.", phoneId);
  }

  const sections = [];
  if (pendingUsers && pendingUsers.length > 0) {
    sections.push({
      title: 'Inscriptions',
      rows: pendingUsers.map(u => ({
        id: `approve_${u.phone_number}`,
        title: u.shop_name.substring(0, 24),
        description: `${u.first_name || ''} · ${u.phone_number}`
      }))
    });
  }
  if (pendingRecharges && pendingRecharges.length > 0) {
    sections.push({
      title: 'Recharges',
      rows: pendingRecharges.map(r => ({
        id: `recharge_${r.id}`,
        title: `${r.amount.toLocaleString('fr-FR')} FCFA`,
        description: `${r.payer_name || 'Sans nom'} · ${r.phone_number}`
      }))
    });
  }

  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp', recipient_type: 'individual', to: phone,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: '⏳ EN ATTENTE' },
          body: { text: 'Sélectionnez un élément à traiter :' },
          action: { button: 'Voir la liste', sections }
        }
      },
      { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error("Erreur envoyerListeAttente:", err.response ? err.response.data : err.message);
  }
}

// 8. GENERATION ET ENVOI DE L'IMAGE REÇU
async function genererEtEnvoyerRecu(phone, user, items, clientName, phoneId) {
  try {
    if (!user.receipt_quota || user.receipt_quota <= 0) {
      return await envoyerTexte(
        phone,
        `⚠️ *Solde épuisé (0 reçu restant).*\n\nVeuillez recharger votre compte pour continuer à générer des reçus.`,
        phoneId
      );
    }

    const totalAmount = items.reduce((sum, item) => sum + item.total_price, 0);

    const { data: sale } = await supabase
      .from('sales')
      .insert([{ user_id: user.phone_number, client_name: clientName, total_amount: totalAmount, items: items }])
      .select()
      .single();

    const saleId = sale ? sale.id : Date.now().toString().slice(-6);

    // --- Format resserré façon vrai ticket ---
    const width = 480;
    const contentX = 32;
    const contentRight = width - 32;
    const baseHeight = 630;
    const itemHeight = 38;
    const height = baseHeight + (items.length * itemHeight);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const papierTicket = '#FBF6EC';
    const encreMarche = '#015E54';
    const ambreVif = '#F2A63A';
    const encreDouce = '#4B6660';
    const ligneClair = '#E3D9C2';
    const grisVia = '#9A9488';

    function drawRoundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    // Fond en dégradé + bordure de carte
    const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
    bgGradient.addColorStop(0, '#FBF6EC');
    bgGradient.addColorStop(1, '#FEFDFA');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = ligneClair;
    ctx.lineWidth = 1.5;
    drawRoundRect(12, 12, width - 24, height - 24, 12);
    ctx.stroke();

    let logoImg = null;
    if (user.logo_url) {
      try {
        const logoRes = await axios.get(user.logo_url, { responseType: 'arraybuffer' });
        logoImg = await loadImage(Buffer.from(logoRes.data));
      } catch (e) {
        console.error("Logo introuvable, fallback sans logo:", e.message);
      }
    }

    let headerBottom;

    if (logoImg) {
      // --- En-tête avec logo du commerçant ---
      const boxSize = 64;
      ctx.fillStyle = '#FFFFFF';
      drawRoundRect(contentX, 28, boxSize, boxSize, 10);
      ctx.fill();
      ctx.strokeStyle = ligneClair;
      ctx.stroke();

      ctx.save();
      drawRoundRect(contentX + 5, 33, boxSize - 10, boxSize - 10, 7);
      ctx.clip();
      const scale = Math.max((boxSize - 10) / logoImg.width, (boxSize - 10) / logoImg.height);
      const lw = logoImg.width * scale, lh = logoImg.height * scale;
      ctx.drawImage(logoImg, contentX + 5 + (boxSize - 10 - lw) / 2, 33 + (boxSize - 10 - lh) / 2, lw, lh);
      ctx.restore();

      const textX = contentX + boxSize + 16;
      ctx.fillStyle = encreMarche;
      ctx.font = 'bold 22px Georgia, serif';
      ctx.textAlign = 'left';
      ctx.fillText(user.shop_name.toUpperCase(), textX, 55);

      ctx.fillStyle = encreDouce;
      ctx.font = '12px sans-serif';
      ctx.fillText('Reçu de vente', textX, 75);

      ctx.fillStyle = grisVia;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('via B-Ticket', contentRight, 40);

      headerBottom = 28 + boxSize + 14;
    } else {
      // --- En-tête par défaut à la charte B-Ticket ---
      const badgeH = 72;
      ctx.fillStyle = encreMarche;
      drawRoundRect(contentX, 28, contentRight - contentX, badgeH, 8);
      ctx.fill();

      ctx.fillStyle = papierTicket;
      ctx.beginPath();
      ctx.arc(contentX, 28 + badgeH / 2, 13, 0, Math.PI * 2);
      ctx.arc(contentRight, 28 + badgeH / 2, 13, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = papierTicket;
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(contentX + 70, 40);
      ctx.lineTo(contentX + 70, 28 + badgeH - 12);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      ctx.fillStyle = ambreVif;
      ctx.font = 'bold 28px Georgia, serif';
      ctx.textAlign = 'left';
      ctx.fillText('B', contentX + 20, 28 + badgeH / 2 + 10);
      ctx.fillStyle = papierTicket;
      ctx.fillText('Ticket', contentX + 88, 28 + badgeH / 2 + 10);

      headerBottom = 28 + badgeH + 24;
      ctx.fillStyle = encreMarche;
      ctx.font = 'bold 20px Georgia, serif';
      ctx.fillText(user.shop_name.toUpperCase(), contentX, headerBottom);
      headerBottom += 10;
    }

    const receiptNum = `#BT-${saleId}`;
    const dateStr = new Date().toLocaleDateString('fr-FR');

    ctx.textAlign = 'left';
    ctx.fillStyle = encreDouce;
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText(`N° ${receiptNum}   |   ${dateStr}`, contentX, headerBottom + 26);

    ctx.strokeStyle = ligneClair;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(contentX, headerBottom + 40);
    ctx.lineTo(contentRight, headerBottom + 40);
    ctx.stroke();

    ctx.fillStyle = encreDouce;
    ctx.font = '10.5px sans-serif';
    ctx.fillText('CLIENT', contentX, headerBottom + 62);
    ctx.fillStyle = encreMarche;
    ctx.font = 'bold 16px Georgia, serif';
    ctx.fillText(clientName, contentX, headerBottom + 82);

    // En-tête de tableau
    let currentY = headerBottom + 116;
    ctx.fillStyle = encreDouce;
    ctx.font = 'bold 10.5px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ARTICLE', contentX, currentY);
    ctx.textAlign = 'center';
    ctx.fillText('QTÉ', 280, currentY);
    ctx.textAlign = 'right';
    ctx.fillText('P.U', 355, currentY);
    ctx.fillText('TOTAL', contentRight, currentY);
    ctx.textAlign = 'left';

    currentY += 10;
    ctx.strokeStyle = ligneClair;
    ctx.beginPath();
    ctx.moveTo(contentX, currentY);
    ctx.lineTo(contentRight, currentY);
    ctx.stroke();
    currentY += 26;

    items.forEach((item, idx) => {
      const unitPrice = Math.round(item.total_price / item.qty);

      if (idx % 2 === 1) {
        ctx.fillStyle = '#F3ECDC';
        ctx.fillRect(contentX - 8, currentY - 19, (contentRight - contentX) + 16, itemHeight - 6);
      }

      ctx.fillStyle = encreMarche;
      ctx.font = 'bold 13px Georgia, serif';
      ctx.textAlign = 'left';
      ctx.fillText(item.name.substring(0, 18), contentX, currentY);

      ctx.font = '12px ui-monospace, monospace';
      ctx.fillStyle = encreDouce;
      ctx.textAlign = 'center';
      ctx.fillText(`${item.qty}`, 280, currentY);
      ctx.textAlign = 'right';
      ctx.fillText(`${unitPrice.toLocaleString('fr-FR')}`, 355, currentY);
      ctx.fillStyle = encreMarche;
      ctx.font = 'bold 12px ui-monospace, monospace';
      ctx.fillText(`${item.total_price.toLocaleString('fr-FR')}`, contentRight, currentY);
      ctx.textAlign = 'left';

      currentY += itemHeight;
    });

    currentY += 12;
    ctx.fillStyle = ambreVif;
    drawRoundRect(contentX, currentY, contentRight - contentX, 62, 8);
    ctx.fill();

    ctx.fillStyle = encreMarche;
    ctx.font = 'bold 14px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText('TOTAL PAYÉ', contentX + 20, currentY + 37);
    ctx.font = 'bold 20px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${totalAmount.toLocaleString('fr-FR')} FCFA`, contentRight - 16, currentY + 37);
    ctx.textAlign = 'left';

    currentY += 62 + 28;
    ctx.fillStyle = encreDouce;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Merci pour votre confiance !', width / 2, currentY);

    // Perforation avant le footer
    currentY += 22;
    ctx.strokeStyle = ligneClair;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(20, currentY);
    ctx.lineTo(width - 20, currentY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Footer — signature discrète, sans numéro de téléphone
    currentY += 24;
    let iconOk = false;
    try {
      if (!brainiacsIconImg) {
        brainiacsIconImg = await loadImage(Buffer.from(BRAINIACS_ICON_B64, 'base64'));
      }
      iconOk = true;
    } catch (e) {
      console.error("Pictogramme Brainiacs indisponible, signature sans icône:", e.message);
      brainiacsIconImg = null;
    }

    const iconH = 11;
    const iconW = iconOk ? iconH * (brainiacsIconImg.width / brainiacsIconImg.height) : 0;
    ctx.font = '9.5px sans-serif';
    const part1 = 'Fait avec B-Ticket · un produit';
    const w1 = ctx.measureText(part1).width;
    ctx.font = 'bold 9.5px sans-serif';
    const w2 = ctx.measureText('Brainiacs').width;
    const groupWidth = w1 + 5 + (iconOk ? iconW + 4 : 0) + w2;
    const startX = (width - groupWidth) / 2;

    ctx.textAlign = 'left';
    ctx.fillStyle = ambreVif;
    ctx.font = '9.5px sans-serif';
    ctx.fillText(part1, startX, currentY);
    let cursorX = startX + w1 + 5;
    if (iconOk) {
      ctx.drawImage(brainiacsIconImg, cursorX, currentY - iconH + 1, iconW, iconH);
      cursorX += iconW + 4;
    }
    ctx.fillStyle = encreMarche;
    ctx.font = 'bold 9.5px sans-serif';
    ctx.fillText('Brainiacs', cursorX, currentY);
    ctx.textAlign = 'left';

    const imageBuffer = canvas.toBuffer('image/png');

    const newQuota = Math.max(0, user.receipt_quota - 1);
    const { data: updateData, error: updateError } = await supabase
      .from('users')
      .update({ receipt_quota: newQuota })
      .eq('phone_number', user.phone_number)
      .select();

    if (updateError) {
      console.error("❌ ÉCHEC MISE À JOUR QUOTA:", updateError);
    } else if (!updateData || updateData.length === 0) {
      console.error(`⚠️ AUCUNE LIGNE TROUVÉE pour phone_number = "${user.phone_number}"`);
    } else {
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

async function traiterMessageEntrant(phone, text, interactiveId, phoneId, imageId) {
  const textUpper = text ? text.toUpperCase().trim() : '';

  // ------------------------------------------
  // MODULE ADMINISTRATEUR
  // ------------------------------------------
  if (phone === ADMIN_PHONE) {
if (interactiveId && interactiveId.startsWith('approve_')) {
  const targetPhone = interactiveId.replace('approve_', '');
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  await supabase.from('users').update({
    is_approved: true,
    receipt_quota: QUOTA_DEFAUT_APPROBATION,
    last_free_credit_month: currentMonth
  }).eq('phone_number', targetPhone);
      const { data: targetUser } = await supabase.from('users').select('*').eq('phone_number', targetPhone).single();
      if (targetUser) {
        await envoyerTexte(targetPhone, t(targetUser, 'congrats_approved').replace('{quota}', QUOTA_DEFAUT_APPROBATION), phoneId);
        await envoyerTexte(targetPhone, t(targetUser, 'guide_usage'), phoneId); 
      }
      return await envoyerTexte(phone, `✅ ${targetPhone} validé avec ${QUOTA_DEFAUT_APPROBATION} reçus.`, phoneId);
    }

    if (interactiveId && interactiveId.startsWith('recharge_')) {
      const reqId = interactiveId.replace('recharge_', '');
      const { data: reqData } = await supabase.from('recharge_requests').select('*').eq('id', reqId).single();
      if (!reqData || reqData.status !== 'pending') {
        return await envoyerTexte(phone, "⚠️ Demande introuvable ou déjà traitée.", phoneId);
      }
      const creditsCalcules = Math.round(reqData.amount / TARIF_REF_FCFA);

      await supabase.from('conversations').upsert({
        phone_number: phone,
        step: 'CONFIRM_RECHARGE',
        data: { request_id: reqData.id, target_phone: reqData.phone_number, credits: creditsCalcules }
      });

      return await axios.post(
        `https://graph.facebook.com/v18.0/${phoneId}/messages`,
        {
          messaging_product: 'whatsapp', recipient_type: 'individual', to: phone,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: `💰 ${reqData.payer_name || 'Sans nom'} — ${reqData.amount.toLocaleString('fr-FR')} FCFA\nVendeur : ${reqData.phone_number}\n\n≈ *${creditsCalcules} reçus* (à ${TARIF_REF_FCFA} FCFA/reçu)` },
            action: { buttons: [{ type: 'reply', reply: { id: 'confirm_recharge', title: `✅ Créditer ${creditsCalcules}` } }] }
          }
        },
        { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
      );
    }
    if (interactiveId === 'confirm_credits_mensuels') {
      const { data: adminConv } = await supabase.from('conversations').select('*').eq('phone_number', phone).single();
      if (adminConv && adminConv.step === 'CONFIRM_CREDITS_MENSUELS') {
        const { currentMonth, phones } = adminConv.data;
        await executerCreditsMensuels(currentMonth, phones);
        await supabase.from('conversations').delete().eq('phone_number', phone);
        return await envoyerTexte(phone, `✅ ${phones.length} vendeur(s) crédités pour ${currentMonth}.`, phoneId);
      }
    }

    if (interactiveId === 'confirm_recharge') {
      const { data: adminConv } = await supabase.from('conversations').select('*').eq('phone_number', phone).single();
      if (adminConv && adminConv.step === 'CONFIRM_RECHARGE') {
        const { request_id, target_phone, credits } = adminConv.data;
        await supabase.from('recharge_requests').update({ status: 'done' }).eq('id', request_id);
        const { data: u } = await supabase.from('users').select('*').eq('phone_number', target_phone).single();
        const newQ = (u.receipt_quota || 0) + credits;
        await supabase.from('users').update({ receipt_quota: newQ }).eq('phone_number', target_phone);
        await supabase.from('conversations').delete().eq('phone_number', phone);

        await envoyerTexte(target_phone, t(u, 'recharge_success').replace('{quota}', credits).replace('{total}', newQ), phoneId);
        return await envoyerTexte(phone, `✅ Recharge confirmée. Nouveau solde : ${newQ}.`, phoneId);
      }
    }
    if (textUpper === 'ADMIN' || textUpper === 'DASHBOARD') {
      const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
      const { count: pendingUsers } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_approved', false);
      const { count: totalProducts } = await supabase.from('products').select('*', { count: 'exact', head: true });

      const adminMsg = 
        `📊 *TABLEAU DE BORD ADMIN B-TICKET*\n` +
        `-----------------------------------\n` +
        `*Commerçants inscrits :* ${totalUsers || 0}\n` +
        `*En attente de validation :* ${pendingUsers || 0}\n` +
        `*Articles au catalogue :* ${totalProducts || 0}\n\n` +
        `*COMMANDES DISPONIBLES :*\n` +
        `• *ATTENTE* : Voir les comptes non approuvés.\n` +
        `• *CREDITS* : Distribuer les 15 reçus gratuits du mois.\n` + 
        `• *VALIDER <numéro> <quota>* : Approuver un compte.\n` +
        `• *RECHARGE <numéro> <quota>* : Ajouter des reçus.`;

      return await envoyerTexte(phone, adminMsg, phoneId);
    }

    if (textUpper === 'CREDITS') {
  const { currentMonth, count, phones } = await previsualiserCreditsMensuels();
  if (count === 0) {
    return await envoyerTexte(phone, `✅ Tout le monde a déjà été crédité pour ${currentMonth}.`, phoneId);
  }
  await supabase.from('conversations').upsert({
    phone_number: phone,
    step: 'CONFIRM_CREDITS_MENSUELS',
    data: { currentMonth, phones }
  });
  return await axios.post(
    `https://graph.facebook.com/v18.0/${phoneId}/messages`,
    {
      messaging_product: 'whatsapp', recipient_type: 'individual', to: phone,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: `📅 Crédit mensuel gratuit (${currentMonth})\n\n${count} vendeur(s) vont recevoir +15 reçus.` },
        action: { buttons: [{ type: 'reply', reply: { id: 'confirm_credits_mensuels', title: `✅ Créditer les ${count}` } }] }
      }
    },
    { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
  );
}

    if (textUpper === 'ATTENTE') {
      return await envoyerListeAttente(phone, phoneId);
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
    if (text && text.toLowerCase().trim() === 'logo') {
    await supabase.from('conversations').upsert({ phone_number: phone, step: 'AWAITING_LOGO' });
    return await envoyerTexte(phone, "📷 Envoie une photo de ton logo (idéalement carrée).", phoneId);
  }

  // ------------------------------------------
  // CHARGEMENT PROFIL UTILISATEUR + CONVERSATION
  // ------------------------------------------
  let { data: user } = await supabase.from('users').select('*').eq('phone_number', phone).single();
  const { data: conv } = await supabase.from('conversations').select('*').eq('phone_number', phone).single();

  // ⬇️ NOUVEAU : réception d'une image pendant AWAITING_LOGO — à placer juste après le chargement de conv
  if (imageId && conv && conv.step === 'AWAITING_LOGO') {
    await supabase.from('conversations').delete().eq('phone_number', phone);
    try {
      const mediaInfo = await axios.get(`https://graph.facebook.com/v18.0/${imageId}`,
        { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` } });
      const mediaRes = await axios.get(mediaInfo.data.url,
        { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` }, responseType: 'arraybuffer' });
      const buffer = Buffer.from(mediaRes.data);
      const logoUrl = await sauvegarderLogo(phone, buffer, mediaInfo.data.mime_type);

      if (logoUrl) {
        await supabase.from('users').update({ logo_url: logoUrl }).eq('phone_number', phone);
        return await envoyerTexte(phone, "✅ Logo enregistré ! Il apparaîtra sur tes prochains reçus.", phoneId);
      }
      return await envoyerTexte(phone, "❌ Erreur lors de l'enregistrement, réessaie.", phoneId);
    } catch (err) {
      console.error("Erreur traitement logo:", err.response?.data || err.message);
      return await envoyerTexte(phone, "❌ Erreur lors du téléchargement, réessaie.", phoneId);
    }
  }
  // ⬆️ FIN NOUVEAU

  if (!user) {
    if (!conv) {
      await supabase.from('conversations').upsert({ phone_number: phone, step: 'ONBOARDING_FIRST_NAME' });
      return await envoyerTexte(phone, "Bienvenue sur *B-Ticket* ! 🧾\n\nQuel est votre *prénom* ?", phoneId);
    }

    if (conv.step === 'ONBOARDING_FIRST_NAME') {
      await supabase.from('conversations').update({
        step: 'ONBOARDING_SHOP_NAME',
        data: { first_name: text.trim() }
      }).eq('phone_number', phone);
      return await envoyerTexte(phone, `Ravi de vous rencontrer ${text.trim()} ! 👋\n\nQuel est le *nom de votre boutique* ?`, phoneId);
    }

    if (conv.step === 'ONBOARDING_SHOP_NAME') {
      // ⬇️ Plus d'insertion en base ici — juste stocké dans la conversation
      await supabase.from('conversations').update({
        step: 'ONBOARDING_CATALOG',
        data: { ...conv.data, shop_name: text.trim(), catalog_items: [] }
      }).eq('phone_number', phone);
      return await envoyerTexte(phone,
        `Parfait ! Une dernière étape : ajoute quelques articles à ton catalogue.\n\n` +
        `Envoie *Nom, Prix* (ex: Coupe, 1500), un par un.\n` +
        `Écris *FIN* quand tu as terminé, ou *PASSER* pour configurer plus tard.`,
        phoneId);
    }

    if (conv.step === 'ONBOARDING_CATALOG') {
      const tLower = text.trim().toLowerCase();
      if (tLower === 'fin' || tLower === 'passer') {
        await supabase.from('conversations').update({ step: 'ONBOARDING_LOGO', data: conv.data }).eq('phone_number', phone);
        return await envoyerTexte(phone,
          "📷 Dernière étape (optionnelle) : envoie une photo de ton logo, idéalement carrée.\n\nOu écris *PASSER* pour l'ajouter plus tard.",
          phoneId);
      }

      const parts = text.split(',').map(p => p.trim());
      const price = parts.length === 2 ? parseInt(parts[1].replace(/[^0-9]/g, ''), 10) : NaN;
      if (parts.length === 2 && parts[0] && price > 0) {
        const items = [...(conv.data.catalog_items || []), { name: parts[0], price }];
        await supabase.from('conversations').update({ data: { ...conv.data, catalog_items: items } }).eq('phone_number', phone);
        return await envoyerTexte(phone, `✅ *${parts[0]}* ajouté (${price.toLocaleString('fr-FR')} FCFA). Un autre ? Sinon écris *FIN*.`, phoneId);
      }
      return await envoyerTexte(phone, "Format non reconnu. Exemple : *Coupe, 1500* — ou écris *FIN*.", phoneId);
    }

    if (conv.step === 'ONBOARDING_LOGO') {
      let logoUrl = null;

      if (imageId) {
        try {
          const mediaInfo = await axios.get(`https://graph.facebook.com/v18.0/${imageId}`,
            { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` } });
          const mediaRes = await axios.get(mediaInfo.data.url,
            { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` }, responseType: 'arraybuffer' });
          logoUrl = await sauvegarderLogo(phone, Buffer.from(mediaRes.data), mediaInfo.data.mime_type);
        } catch (err) {
          console.error("Erreur logo onboarding:", err.response?.data || err.message);
        }
      } else if (!text || text.trim().toLowerCase() !== 'passer') {
        return await envoyerTexte(phone, "Envoie une photo, ou écris *PASSER*.", phoneId);
      }

      // ⬇️ Finalisation : tout s'écrit d'un coup, maintenant que l'inscription est complète
      await supabase.from('users').insert([{
        phone_number: phone,
        first_name: conv.data.first_name,
        shop_name: conv.data.shop_name,
        logo_url: logoUrl,
        is_approved: false,
        receipt_quota: 0
      }]);

      if (conv.data.catalog_items && conv.data.catalog_items.length > 0) {
        const rows = conv.data.catalog_items.map(it => ({ user_phone: phone, name: it.name, price: it.price }));
        await supabase.from('products').insert(rows);
      }

      await supabase.from('conversations').delete().eq('phone_number', phone);
      return await envoyerTexte(phone,
        logoUrl ? "✅ Inscription complète, logo enregistré ! Ton compte est en attente de validation."
                : "✅ Inscription complète ! Ton compte est en attente de validation.",
        phoneId);
    }

    // Cas de repli : conv existe mais avec un step inconnu — on relance proprement
    await supabase.from('conversations').delete().eq('phone_number', phone);
    return await envoyerTexte(phone, "Bienvenue sur *B-Ticket* ! 🧾\n\nQuel est votre *prénom* ?", phoneId);
  }

  if (!user.is_approved) {
    return await envoyerTexte(phone, "⏳ Votre compte est en attente d'approbation par l'administrateur. Merci de patienter !", phoneId);
  }

  if (!user.is_approved) {
    return await envoyerTexte(phone, "⏳ Votre compte est en attente d'approbation par l'administrateur. Merci de patienter !", phoneId);
  }

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
    if (interactiveId === 'btn_menu_catalog'){
      return await ouvrirCatalogueVendeur(phone, user, phoneId);
    }
    if (interactiveId === 'btn_menu_sales'){
      return await envoyerHistoriqueVentes(phone, user, phoneId);
    }
    if (interactiveId === 'btn_menu_help'){
      return await envoyerAide(phone, user, phoneId);
    }

    if (interactiveId === 'btn_client_default') {
      if (conv && conv.step === 'ASK_CLIENT_NAME') {
        const items = conv.data.items;
        return await afficherRecuEbauche(phone, user, items, 'Client Comptoir', phoneId);
      }
    }
    if (interactiveId === 'catalog_add') {
      await supabase.from('conversations').upsert({ phone_number: phone, step: 'ADD_PRODUCT_NAME' });
      return await envoyerTexte(phone, "Nom du nouvel article ?", phoneId);
    }

    if (interactiveId === 'btn_add_more') {
      await supabase.from('conversations').upsert({ phone_number: phone, step: 'BUILDING_CART', data: conv ? conv.data : { items: [] } });
      return await ouvrirCatalogueVendeur(phone, user, phoneId);
    }

    if (interactiveId === 'btn_finish_cart') {
      if (conv && conv.data && conv.data.items && conv.data.items.length > 0) {
        await supabase.from('conversations').upsert({ phone_number: phone, step: 'ASK_CLIENT_NAME', data: conv.data });
        return await envoyerDemandeClient(phone, user, conv, phoneId);
      }
    }

    if (interactiveId === 'client_recent_0' || interactiveId === 'client_recent_1') {
      if (conv && conv.step === 'ASK_CLIENT_NAME') {
        const idx = interactiveId === 'client_recent_0' ? 0 : 1;
        const clientName = conv.data.frequents ? conv.data.frequents[idx] : null;
        if (clientName) {
          return await afficherRecuEbauche(phone, user, conv.data.items, clientName, phoneId);
        }
      }
    }

if (interactiveId.startsWith('prod_')) {
  const prodId = interactiveId.replace('prod_', '');
  const { data: prod } = await supabase.from('products').select('*').eq('id', prodId).single();

  if (prod) {
    const existingItems = (conv && conv.data && conv.data.items) ? conv.data.items : [];
    await supabase.from('conversations').upsert({
      phone_number: phone,
      step: 'NEGOTIATE_PRICE',
      data: { items: existingItems, current_product: prod }
    });
    return await envoyerTexte(
      phone,
      `📦 *${prod.name}* — prix catalogue : ${prod.price.toLocaleString('fr-FR')} FCFA\n\n` +
      `Quantité et prix convenu ? (ex: \`2, 4500\`)\nOu juste la quantité si le prix catalogue s'applique (ex: \`2\`)`,
      phoneId
    );
  }
}
  }

  // --------------------------------------
  // COMMANDE POUR CHANGER DE LANGUE
  // ---------------------------------------
  if (text && (text.toLowerCase() === '/lang' || text.toLowerCase() === 'langue')) {
    const newLang = user.language === 'en' ? 'fr' : 'en';
    await supabase.from('users').update({ language: newLang }).eq('phone_number', user.phone_number);
    user.language = newLang;
    return await envoyerTexte(phone, t(user, 'lang_changed'), phoneId);
  }

  if (text && ['vente', 'menu', 'catalogue', 'catalog', 'aide', 'help'].includes(text.toLowerCase().trim())) {
    await supabase.from('conversations').delete().eq('phone_number', phone);
    return await envoyerMenuPrincipal(phone, user, phoneId);
}
  // ⬇️ ENCORE NOUVEAU : déclencheur de demande de recharge
  if (text && text.toLowerCase().trim() === 'recharge') {
    await envoyerTexte(phone,
      `💳 *Recharger votre compte*\n\n` +
      `1. Effectuez le paiement au code marchand Orange Money : *[ton code]*\n` +
      `2. Répondez avec : *Nom du compte payeur, Montant* (ex: Jean Mballa, 5000)\n\n` +
      `Votre demande sera traitée sous peu.`,
      phoneId
    );
    await supabase.from('conversations').upsert({ phone_number: phone, step: 'AWAITING_RECHARGE_PROOF' });
    return;
  }
  // ⬆️ FIN NOUVEAU
   // ⬇️ NOUVEAU : réception de la quantité / prix négocié
  if (conv && conv.step === 'NEGOTIATE_PRICE' && text) {
    const prod = conv.data.current_product;
    let qty, finalPrice;

    if (text.includes(',')) {
      const parts = text.split(',');
      qty = parseInt(parts[0].replace(/[^0-9]/g, ''), 10) || 1;
      finalPrice = parseInt(parts[1].replace(/[^0-9]/g, ''), 10);
    } else {
      qty = parseInt(text.replace(/[^0-9]/g, ''), 10) || 1;
      finalPrice = prod.price * qty;
    }

    if (!finalPrice || finalPrice <= 0) {
      return await envoyerTexte(phone, "Montant invalide. Exemple : `2, 4500` ou juste `2`.", phoneId);
    }

    const items = [...(conv.data.items || []), { name: prod.name, qty, total_price: finalPrice }];
    await supabase.from('conversations').update({ step: 'CART_ACTIVE', data: { items } }).eq('phone_number', phone);
    return await envoyerBoutonsCart(phone, items, phoneId);
  }
    // ------------------------------------------
  // SAISIE DU NOM DU CLIENT DEPUIS LE MODE CLASSIQUE
  // ------------------------------------------
  if (conv && conv.step === 'ASK_CLIENT_NAME' && text) {
    const items = conv.data.items;
    return await afficherRecuEbauche(phone, user, items, text.trim(), phoneId);
  }
    // Réception de la preuve de recharge
  if (conv && conv.step === 'AWAITING_RECHARGE_PROOF' && text) {
    const parts = text.split(',').map(p => p.trim());
    const payerName = parts.length >= 2 ? parts[0] : null;
    const amountRaw = parts.length >= 2 ? parts[1] : parts[0];
    const amount = parseInt(amountRaw.replace(/[^0-9]/g, ''), 10);

    if (!amount || amount <= 0) {
      return await envoyerTexte(phone, "Format non reconnu. Envoie : *Nom du compte, Montant* (ex: Jean Mballa, 5000)", phoneId);
    }

    await supabase.from('conversations').delete().eq('phone_number', phone);
    await supabase.from('recharge_requests').insert({ phone_number: phone, payer_name: payerName, amount });
    return await envoyerTexte(phone, "✅ Demande enregistrée. Elle sera traitée sous peu.", phoneId);
  }
  
  // 4. Nouveaux ADD_PRODUCT_NAME / ADD_PRODUCT_PRICE
    if (conv && conv.step === 'ADD_PRODUCT_NAME' && text) {
    await supabase.from('conversations').update({ step: 'ADD_PRODUCT_PRICE', data: { name: text.trim() } }).eq('phone_number', phone);
    return await envoyerTexte(phone, `Prix pour *${text.trim()}* ?`, phoneId);
  }

  if (conv && conv.step === 'ADD_PRODUCT_PRICE' && text) {
    const price = parseInt(text.replace(/[^0-9]/g, ''), 10);
    if (!price || price <= 0) {
      return await envoyerTexte(phone, "Prix invalide, réessaie (chiffres uniquement).", phoneId);
    }
    await supabase.from('products').insert({ user_phone: phone, name: conv.data.name, price });
    await supabase.from('conversations').delete().eq('phone_number', phone);
    return await envoyerTexte(phone, `✅ *${conv.data.name}* ajouté à ${price.toLocaleString('fr-FR')} FCFA.`, phoneId);
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
      await autoSaveProducts(user.phone_number, items);
      return await afficherRecuEbauche(phone, user, items, clientName, phoneId);
    }
  }

  // MENU PAR DÉFAUT SI AUCUNE COMMANDE N'EST RECONNUE
  const defaultMessage = `${t(user, 'welcome')}\n\n${t(user, 'express_prompt')}\n\nOu envoyez *MENU* pour toutes les options.`;
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
app.post('/webhook', verifierSignatureMeta, (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    // 1. Envoi immédiat du 200 OK à Meta pour éviter les timeouts et renvois multiples
    res.status(200).send('EVENT_RECEIVED');

    // 2. Traitement asynchrone en arrière-plan
    if (
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages &&
      body.entry[0].changes[0].value.messages[0]
    ) {
      const message = body.entry[0].changes[0].value.messages[0];
      const phoneId = body.entry[0].changes[0].value.metadata.phone_number_id;
      const phone = message.from;
            if (messagesTraites.has(message.id)) {
        console.log("Doublon ignoré :", message.id);
        return;
      }
      messagesTraites.add(message.id);
      if (messagesTraites.size > 500) {
        messagesTraites.clear();
      }

      let text = null;
      let interactiveId = null;
      let imageId = null;

      if (message.type === 'text') {
        text = message.text.body;
      } else if (message.type === 'interactive') {
        if (message.interactive.type === 'button_reply') {
          interactiveId = message.interactive.button_reply.id;
        } else if (message.interactive.type === 'list_reply') {
          interactiveId = message.interactive.list_reply.id;
        }
      } else if (message.type === 'image') {
        imageId = message.image.id;
      }

      traiterMessageEntrant(phone, text, interactiveId, phoneId, imageId).catch(err => {
        console.error("❌ Erreur traitement message entrant:", err);
      });
    }
  } else {
    res.sendStatus(404);
  }
});

// START SERVER
app.listen(PORT, () => {
  console.log(`Serveur B-Ticket démarré sur le port ${PORT}`);
});
