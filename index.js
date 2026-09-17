const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { createClient } = require('@supabase/supabase-js');
const BRAINIACS_ICON_B64 = "PASTE_LA_CHAINE_ICI";
let brainiacsIconImg = null; // mis en cache après le premier chargement
const TARIF_REF_FCFA = 35;        // prix moyen pondéré par reçu, sert à convertir un montant en crédits
const QUOTA_DEFAUT_APPROBATION = 100;

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
    recharge_success: "{name} Votre compte a été rechargé de {quota} reçus ! Nouveau solde : {total} reçus."
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

// 4. Demander le nom du client
async function envoyerDemandeClient(phone, user, phoneId) {
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

// 6. Uploader l'image vers Meta WhatsApp Media
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
    // Blocage si le quota est déjà épuisé — avant tout traitement, toute écriture en base
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

    const width = 650;
    const baseHeight = 700;
    const itemHeight = 42;
    const height = baseHeight + (items.length * itemHeight);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const papierTicket = '#FBF6EC';
    const encreMarche = '#015E54';
    const ambreVif = '#F2A63A';
    const encreDouce = '#4B6660';
    const ligneClair = '#E3D9C2';

    function drawRoundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    // Fond général + carte
    const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
    bgGradient.addColorStop(0, '#FBF6EC');
    bgGradient.addColorStop(1, '#FEFDFA');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = ligneClair;
    ctx.lineWidth = 1.5;
    drawRoundRect(16, 16, width - 32, height - 32, 14);
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
      const boxX = 44, boxY = 44, boxSize = 92;
      ctx.fillStyle = '#FFFFFF';
      drawRoundRect(boxX, boxY, boxSize, boxSize, 12);
      ctx.fill();
      ctx.strokeStyle = ligneClair;
      ctx.stroke();

      ctx.save();
      drawRoundRect(boxX + 6, boxY + 6, boxSize - 12, boxSize - 12, 8);
      ctx.clip();
      const scale = Math.max((boxSize - 12) / logoImg.width, (boxSize - 12) / logoImg.height);
      const lw = logoImg.width * scale, lh = logoImg.height * scale;
      ctx.drawImage(logoImg, boxX + 6 + (boxSize - 12 - lw) / 2, boxY + 6 + (boxSize - 12 - lh) / 2, lw, lh);
      ctx.restore();

      ctx.fillStyle = encreMarche;
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(user.shop_name.toUpperCase(), boxX + boxSize + 20, boxY + 40);

      ctx.strokeStyle = ambreVif;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(boxX + boxSize + 20, boxY + 54);
      ctx.lineTo(boxX + boxSize + 20 + 160, boxY + 54);
      ctx.stroke();

      ctx.fillStyle = encreDouce;
      ctx.font = '13px sans-serif';
      ctx.fillText('Reçu de vente', boxX + boxSize + 20, boxY + 76);

      // Mini-signature B-Ticket, discrète, en haut à droite
      ctx.fillStyle = encreDouce;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('via B-Ticket', width - 44, boxY + 20);

      headerBottom = boxY + boxSize + 20;
    } else {
      // --- En-tête par défaut à la charte B-Ticket (pas de logo vendeur) ---
      ctx.fillStyle = encreMarche;
      drawRoundRect(40, 40, width - 80, 96, 10);
      ctx.fill();

      ctx.fillStyle = papierTicket;
      ctx.beginPath();
      ctx.arc(40, 88, 15, 0, Math.PI * 2);
      ctx.arc(width - 40, 88, 15, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = papierTicket;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(118, 50);
      ctx.lineTo(118, 126);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = ambreVif;
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('B', 72, 100);
      ctx.fillStyle = papierTicket;
      ctx.fillText('Ticket', 132, 100);

      ctx.fillStyle = encreMarche;
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(user.shop_name.toUpperCase(), 50, 176);

      headerBottom = 176;
    }

    const saleIdShort = sale ? sale.id : Date.now().toString().slice(-6);
    const receiptNum = `#BT-${saleIdShort}`;
    const dateStr = new Date().toLocaleDateString('fr-FR');

    ctx.fillStyle = encreDouce;
    ctx.font = '15px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`N° ${receiptNum}   |   ${dateStr}`, 50, headerBottom + 30);

    ctx.strokeStyle = ligneClair;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(50, headerBottom + 50);
    ctx.lineTo(width - 50, headerBottom + 50);
    ctx.stroke();

    ctx.fillStyle = encreDouce;
    ctx.font = '14px sans-serif';
    ctx.fillText('CLIENT', 50, headerBottom + 80);
    ctx.fillStyle = encreMarche;
    ctx.font = 'bold 19px sans-serif';
    ctx.fillText(clientName, 50, headerBottom + 104);

    // En-tête de tableau
    let currentY = headerBottom + 145;
    ctx.fillStyle = encreDouce;
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('ARTICLE', 50, currentY);
    ctx.textAlign = 'center';
    ctx.fillText('QTÉ', 370, currentY);
    ctx.textAlign = 'right';
    ctx.fillText('P.U', 470, currentY);
    ctx.fillText('TOTAL', width - 50, currentY);
    ctx.textAlign = 'left';

    currentY += 14;
    ctx.strokeStyle = ligneClair;
    ctx.beginPath();
    ctx.moveTo(50, currentY);
    ctx.lineTo(width - 50, currentY);
    ctx.stroke();
    currentY += 28;

    items.forEach((item, idx) => {
      const unitPrice = Math.round(item.total_price / item.qty);

      if (idx % 2 === 1) {
        ctx.fillStyle = '#F3ECDC';
        ctx.fillRect(40, currentY - 22, width - 80, itemHeight - 6);
      }

      ctx.fillStyle = encreMarche;
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(item.name.substring(0, 26), 50, currentY);

      ctx.font = '15px monospace';
      ctx.fillStyle = encreDouce;
      ctx.textAlign = 'center';
      ctx.fillText(`${item.qty}`, 370, currentY);
      ctx.textAlign = 'right';
      ctx.fillText(`${unitPrice.toLocaleString('fr-FR')}`, 470, currentY);
      ctx.fillStyle = encreMarche;
      ctx.font = 'bold 15px monospace';
      ctx.fillText(`${item.total_price.toLocaleString('fr-FR')}`, width - 50, currentY);
      ctx.textAlign = 'left';

      currentY += itemHeight;
    });

    currentY += 18;
    ctx.fillStyle = ambreVif;
    drawRoundRect(50, currentY, width - 100, 84, 10);
    ctx.fill();

    ctx.fillStyle = encreMarche;
    ctx.font = 'bold 19px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('TOTAL PAYÉ', 78, currentY + 49);
    ctx.font = 'bold 30px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${totalAmount.toLocaleString('fr-FR')} FCFA`, width - 78, currentY + 49);
    ctx.textAlign = 'left';

    currentY += 84 + 36;
    ctx.fillStyle = encreDouce;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Merci pour votre confiance !', width / 2, currentY);
    ctx.font = '11px sans-serif';
    ctx.fillText(`Contact : ${user.phone_number}`, width / 2, currentY + 20);

    if (!brainiacsIconImg) {
      brainiacsIconImg = await loadImage(Buffer.from(BRAINIACS_ICON_B64, 'base64'));
    }
    const iconH = 15, iconW = iconH * (brainiacsIconImg.width / brainiacsIconImg.height);
    ctx.font = '10.5px sans-serif';
    const signatureText = 'Fait avec B-Ticket · Un produit';
    const textWidth = ctx.measureText(signatureText).width;
    const groupWidth = textWidth + 6 + iconW + 58; // 58 ≈ largeur approx. de "Brainiacs"
    const startX = (width - groupWidth) / 2;

    ctx.textAlign = 'left';
    ctx.fillStyle = ambreVif;
    ctx.fillText(signatureText, startX, currentY + 42);
    ctx.drawImage(brainiacsIconImg, startX + textWidth + 6, currentY + 42 - iconH + 2, iconW, iconH);
    ctx.fillStyle = encreMarche;
    ctx.font = 'bold 10.5px sans-serif';
    ctx.fillText('Brainiacs', startX + textWidth + 6 + iconW + 4, currentY + 42);
    ctx.textAlign = 'left';

    const imageBuffer = canvas.toBuffer('image/png');

    // Décrémentation sécurisée du quota
    const newQuota = Math.max(0, user.receipt_quota - 1);

    const { data: updateData, error: updateError } = await supabase
      .from('users')
      .update({ receipt_quota: newQuota })
      .eq('phone_number', user.phone_number)
      .select();

    if (updateError) {
      console.error("❌ ÉCHEC MISE À JOUR QUOTA:", updateError);
    } else if (!updateData || updateData.length === 0) {
      console.error(`⚠️ AUCUNE LIGNE TROUVÉE pour phone_number = "${user.phone_number}" (longueur: ${user.phone_number?.length})`);
    } else {
      user.receipt_quota = newQuota;
      console.log(`✅ Quota mis à jour pour ${user.phone_number} → ${newQuota}`, updateData);
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
      await supabase.from('users').update({ is_approved: true, receipt_quota: QUOTA_DEFAUT_APPROBATION }).eq('phone_number', targetPhone);
      const { data: targetUser } = await supabase.from('users').select('*').eq('phone_number', targetPhone).single();
      if (targetUser) {
        await envoyerTexte(targetPhone, t(targetUser, 'congrats_approved').replace('{quota}', QUOTA_DEFAUT_APPROBATION), phoneId);
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
        `• *VALIDER <numéro> <quota>* : Approuver un compte.\n` +
        `• *RECHARGE <numéro> <quota>* : Ajouter des reçus.`;

      return await envoyerTexte(phone, adminMsg, phoneId);
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

  // ------------------------------------------
  // CHARGEMENT PROFIL UTILISATEUR + CONVERSATION
  // ------------------------------------------
  let { data: user } = await supabase.from('users').select('*').eq('phone_number', phone).single();
  const { data: conv } = await supabase.from('conversations').select('*').eq('phone_number', phone).single();

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
      await supabase.from('users').insert([{
        phone_number: phone,
        first_name: conv.data.first_name,
        shop_name: text.trim(),
        is_approved: false,
        receipt_quota: 0
      }]);
      await supabase.from('conversations').update({
        step: 'ONBOARDING_CATALOG',
        data: { ...conv.data, shop_name: text.trim() }
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
        await supabase.from('conversations').delete().eq('phone_number', phone);
        await envoyerTexte(phone,
          `🔔 Nouvelle inscription : ${conv.data.first_name} — boutique *${conv.data.shop_name}* (${phone})\nValider : VALIDER ${phone} 100`,
          phoneId);
        return await envoyerTexte(phone,
          tLower === 'fin' ? "✅ Catalogue enregistré ! Ton compte est en attente de validation."
                            : "D'accord, tu pourras configurer ton catalogue plus tard. Ton compte est en attente de validation.",
          phoneId);
      }

      const parts = text.split(',').map(p => p.trim());
      const price = parts.length === 2 ? parseInt(parts[1].replace(/[^0-9]/g, ''), 10) : NaN;
      if (parts.length === 2 && parts[0] && price > 0) {
        await supabase.from('products').insert({ user_phone: phone, name: parts[0], price });
        return await envoyerTexte(phone, `✅ *${parts[0]}* ajouté (${price.toLocaleString('fr-FR')} FCFA). Un autre ? Sinon écris *FIN*.`, phoneId);
      }
      return await envoyerTexte(phone, "Format non reconnu. Exemple : *Coupe, 1500* — ou écris *FIN*.", phoneId);
    }

    // Cas de repli : conv existe mais avec un step inconnu — on relance proprement
    await supabase.from('conversations').delete().eq('phone_number', phone);
    return await envoyerTexte(phone, "Bienvenue sur *B-Ticket* ! 🧾\n\nQuel est votre *prénom* ?", phoneId);
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
