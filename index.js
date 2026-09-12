const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// --- VARIABLES D'ENVIRONNEMENT ---
const PORT = process.env.PORT || 3000;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const ADMIN_PHONE = process.env.ADMIN_PHONE ? process.env.ADMIN_PHONE.replace(/[^0-9]/g, '') : '';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// --- INITIALISATION SUPABASE ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
  let recap = "🛒 *VOTRE PANIER ACTUEL :*\n\n";
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
              { type: 'reply', reply: { id: 'btn_add_more', title: '➕ Ajouter un article' } },
              { type: 'reply', reply: { id: 'btn_finish_cart', title: '✅ Terminer & Valider' } },
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
    return await envoyerTexte(
      phone,
      "📦 Aucun produit configuré dans le catalogue global.\n\n" +
      "⚡ Vous pouvez directement utiliser le *Mode Express* en envoyant :\n" +
      "`Nom Produit, Quantité, Prix Total`",
      phoneId
    );
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
// ==========================================
// UPLOAD DE L'IMAGE DU REÇU VERS META WHATSAPP
// ==========================================
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
          Authorization: `Bearer ${WHATSAPP_TOKEN}`
        }
      }
    );
    return res;
  } catch (err) {
    console.error("Erreur uploaderMediaWhatsApp:", err.response ? err.response.data : err.message);
    return null;
  }
}

// 6. Uploader l'image vers l'API WhatsApp Media
// GENERATION IMAGE REÇU (CHARTE B-TICKET)
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

    ctx.fillStyle = encreDouce;
    ctx.font = '14px sans-serif';
    ctx.fillText('Merci pour votre confiance !', 200, currentY + 140);
    ctx.font = '12px sans-serif';
    ctx.fillText('Fait avec B-Ticket • Un produit Brainiacs', 180, currentY + 180);

    const imageBuffer = canvas.toBuffer('image/png');
    const FormData = require('form-data');
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', imageBuffer, { filename: 'recu.png', contentType: 'image/png' });

    const mediaRes = await axios.post(
      `https://graph.facebook.com/v20.0/${phoneId}/media`,
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${META_ACCESS_TOKEN}` } }
    );

    await axios.post(
      `https://graph.facebook.com/v20.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'image',
        image: { id: mediaRes.data.id, caption: `Voici le reçu pour *${clientName}* ! Prêt à être transféré. 🧾` }
      },
      { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` } }
    );

    await supabase.from('users').update({ receipt_quota: user.receipt_quota - 1 }).eq('phone_number', phone);

  } catch (error) {
    console.error("[ERREUR GENERATION RECU]:", error.response?.data || error.message);
    await envoyerTexte(phone, "❌ Erreur lors de la création de l'image du reçu.", phoneId);
  }
}

async function envoyerBoutonsCart(to, items, phoneId) {
  let text = `🛒 *Panier actuel (${items.length} article(s)) :*\n`;
  items.forEach((item) => {
    text += `• ${item.name} (x${item.qty}) : ${item.total_price.toLocaleString('fr-FR')} FCFA\n`;
  });

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
              { type: 'reply', reply: { id: 'btn_add_more', title: '➕ Autre article' } },
              { type: 'reply', reply: { id: 'btn_finish_cart', title: '✅ Valider reçu' } }
            ]
          }
        }
      },
      { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` } }
    );
  } catch (error) {
    console.error("[ERREUR BOUTONS CART]:", error.response?.data || error.message);
  }
}

// 7. Générer l'image du reçu avec Canvas
async function creerImageRecu(shopName, clientName, items, totalAmount, saleId) {
  const width = 500;
  const baseHeight = 350;
  const itemHeight = items.length * 35;
  const height = baseHeight + itemHeight;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Fond blanc
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // En-tête
  ctx.fillStyle = '#128C7E'; // Couleur WhatsApp Green
  ctx.fillRect(0, 0, width, 80);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(shopName.toUpperCase(), width / 2, 38);
  ctx.font = '13px Arial';
  ctx.fillText("REÇU DE PAIEMENT OFFICIEL", width / 2, 60);

  // Infos Transaction
  ctx.fillStyle = '#333333';
  ctx.textAlign = 'left';
  ctx.font = '13px Arial';
  const dateStr = new Date().toLocaleString('fr-FR', { timeZone: 'UTC' });
  ctx.fillText(`N° Ticket : BT-${saleId || Date.now().toString().slice(-6)}`, 25, 110);
  ctx.fillText(`Date : ${dateStr}`, 25, 130);
  ctx.fillText(`Client : ${clientName}`, 25, 150);

  // Ligne de séparation
  ctx.strokeStyle = '#CCCCCC';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(25, 170);
  ctx.lineTo(width - 25, 170);
  ctx.stroke();

  // En-tête du tableau
  ctx.font = 'bold 13px Arial';
  ctx.fillText("Article", 25, 195);
  ctx.textAlign = 'center';
  ctx.fillText("Qté", 320, 195);
  ctx.textAlign = 'right';
  ctx.fillText("Total (FCFA)", width - 25, 195);

  // Articles
  let currentY = 225;
  ctx.font = '13px Arial';

  items.forEach(item => {
    ctx.textAlign = 'left';
    ctx.fillText(item.name.substring(0, 30), 25, currentY);
    ctx.textAlign = 'center';
    ctx.fillText(`${item.qty}`, 320, currentY);
    ctx.textAlign = 'right';
    ctx.fillText(`${item.total_price.toLocaleString('fr-FR')}`, width - 25, currentY);
    currentY += 35;
  });

  // Ligne avant total
  ctx.beginPath();
  ctx.moveTo(25, currentY);
  ctx.lineTo(width - 25, currentY);
  ctx.stroke();

  // Total
  currentY += 35;
  ctx.font = 'bold 18px Arial';
  ctx.fillStyle = '#128C7E';
  ctx.textAlign = 'left';
  ctx.fillText("TOTAL PAYÉ :", 25, currentY);
  ctx.textAlign = 'right';
  ctx.fillText(`${totalAmount.toLocaleString('fr-FR')} FCFA`, width - 25, currentY);

  // Pied de page
  currentY += 45;
  ctx.font = 'italic 12px Arial';
  ctx.fillStyle = '#777777';
  ctx.textAlign = 'center';
  ctx.fillText("Merci pour votre confiance !", width / 2, currentY);
  ctx.fillText("Propulsé par B-Ticket Express", width / 2, currentY + 20);

  return canvas.toBuffer('image/png');
}

// 8. Générer et envoyer le reçu complet
async function genererEtEnvoyerRecu(phone, user, items, clientName, phoneId) {
  try {
    const totalAmount = items.reduce((sum, item) => sum + item.total_price, 0);

    const { data: sale, error: saleErr } = await supabase
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

    if (saleErr) {
      console.error("Erreur insertion vente:", saleErr);
      return await envoyerTexte(phone, "❌ Erreur lors de l'enregistrement de la vente.", phoneId);
    }

    const newQuota = Math.max(0, user.receipt_quota - 1);
    await supabase.from('users').update({ receipt_quota: newQuota }).eq('id', user.id);

    const imageBuffer = await creerImageRecu(user.shop_name, clientName, items, totalAmount, sale.id);
    const mediaRes = await uploaderMediaWhatsApp(imageBuffer, 'image/png', phoneId);

    if (mediaRes && mediaRes.data && mediaRes.data.id) {
      const mediaId = mediaRes.data.id;
      const captionText = `Voici le reçu pour *${clientName}* ! Prêt à être transféré. 🧾\nSolde restant : *${newQuota} reçus*`;

      await axios.post(
        `https://graph.facebook.com/v18.0/${phoneId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phone,
          type: 'image',
          image: {
            id: mediaId,
            caption: captionText
          }
        },
        {
          headers: {
            Authorization: `Bearer ${META_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } else {
      await envoyerTexte(phone, "⚠️ Erreur lors de l'envoi de l'image du reçu sur WhatsApp.", phoneId);
    }
  } catch (err) {
    console.error("Erreur genererEtEnvoyerRecu:", err);
    await envoyerTexte(phone, "❌ Une erreur est survenue lors de la génération du reçu.", phoneId);
  }
}// ==========================================
// ROUTER DE CONVERSATION ET GESTION DU BOT
// ==========================================

async function traiterMessageEntrant(phone, text, interactiveId, phoneId) {
  const textUpper = text ? text.toUpperCase() : '';

  // ------------------------------------------
  // MODULE ADMINISTRATEUR (SÉCURISÉ)
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

      let msg = `⏳ *COMPTES EN ATTENTE (${pending.length}) :*\n\n`;
      pending.forEach(u => {
        msg += `• *${u.first_name}* (${u.shop_name})\n  Tel: \`${u.phone_number}\`\n`;
      });
      msg += `\nPour valider : *VALIDER <numéro> <quota>*`;
      return await envoyerTexte(phone, msg, phoneId);
    }

    if (textUpper.startsWith('VALIDER')) {
      const parts = text.split(' ');
      if (parts.length >= 3) {
        const targetPhone = parts[1].replace(/[^0-9]/g, '');
        const quota = parseInt(parts[2], 10);

        if (targetPhone && !isNaN(quota)) {
          const { data: targetUser, error } = await supabase
            .from('users')
            .update({ is_approved: true, receipt_quota: quota })
            .eq('phone_number', targetPhone)
            .select()
            .single();

          if (error || !targetUser) {
            return await envoyerTexte(phone, `❌ Erreur : Numéro \`${targetPhone}\` introuvable.`, phoneId);
          }

          await envoyerTexte(phone, `✅ *Compte activé !*\n\nBoutique : *${targetUser.shop_name}*\nQuota : *${quota} reçus*.`, phoneId);

          return await envoyerTexte(
            targetPhone,
            `🎉 *Votre compte B-Ticket est activé !*\n\n` +
            `Votre boutique *${targetUser.shop_name}* dispose de *${quota} reçus*.\n\n` +
            `⚡ *MODE EXPRESS MULTI-ARTICLES :*\n` +
            `Envoyez vos articles ligne par ligne (Exemple) :\n\n` +
            `Robe Wax, 1, 15000\n` +
            `Sac, 2, 10000\n` +
            `Client: Marie\n\n` +
            `Ou envoyez *VENTE* pour utiliser le menu guidé.`,
            phoneId
          );
        }
      }
      return await envoyerTexte(phone, "⚠️ Format incorrect. Exemple : `VALIDER 237690000000 100`", phoneId);
    }

    if (textUpper.startsWith('RECHARGE')) {
      const parts = text.split(' ');
      if (parts.length >= 3) {
        const targetPhone = parts[1].replace(/[^0-9]/g, '');
        const addQuota = parseInt(parts[2], 10);

        if (targetPhone && !isNaN(addQuota)) {
          const { data: user } = await supabase.from('users').select('*').eq('phone_number', targetPhone).single();
          if (!user) return await envoyerTexte(phone, `❌ Numéro \`${targetPhone}\` non trouvé.`, phoneId);

          const newQuota = user.receipt_quota + addQuota;
          await supabase.from('users').update({ receipt_quota: newQuota }).eq('phone_number', targetPhone);

          await envoyerTexte(phone, `✅ *Recharge effectuée !*\n\nBoutique : *${user.shop_name}*\nNouveau solde : *${newQuota} reçus*.`, phoneId);

          return await envoyerTexte(
            targetPhone,
            `💳 *Recharge effectuée !*\n\n*${addQuota} reçus* ajoutés.\nNouveau solde : *${newQuota} reçus*.`,
            phoneId
          );
        }
      }
      return await envoyerTexte(phone, "⚠️ Format incorrect. Exemple : `RECHARGE 237690000000 50`", phoneId);
    }
  }

  // ------------------------------------------
  // MODULE COMMERÇANTS
  // ------------------------------------------
  let { data: user } = await supabase.from('users').select('*').eq('phone_number', phone).single();
  let { data: conv } = await supabase.from('conversations').select('*').eq('phone_number', phone).single();

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

      await envoyerTexte(
        ADMIN_PHONE,
        `🔔 *NOUVELLE INSCRIPTION !*\n\nNom : ${conv.data.first_name}\nBoutique : ${text}\nTel : \`${phone}\`\n\nPour valider : \`VALIDER ${phone} 100\``,
        phoneId
      );

      return await envoyerTexte(phone, `Félicitations ! La boutique *${text}* a été enregistrée. 🎉\n\nActivez votre compte par OM/MoMo Code Marchand : **123456**.`, phoneId);
    }
  }

  if (user && !user.is_approved) {
    return await envoyerTexte(phone, `Bonjour ${user.first_name} ! ⏳ Votre compte *${user.shop_name}* est en attente de validation.`, phoneId);
  }

  if (user && user.is_approved) {
    const textLower = text.toLowerCase();
    
        // ----------------------------------------------------
    // MODE EXPRESS MULTI-ARTICLES + AUTO-ENREGISTREMENT CATALOGUE
    // ----------------------------------------------------
    if (text && text.includes(',') && !conv) {
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

            // AUTO-ENREGISTREMENT DE L'ARTICLE À LA VOLÉE DANS SUPABASE (SANS BLOQUER)
            const unitPrice = Math.round(totalPrice / qty);
            supabase
              .from('products')
              .select('id')
              .eq('name', prodName)
              .single()
              .then(({ data }) => {
                if (!data) {
                  // Le produit n'existe pas, on l'ajoute au catalogue
                  supabase.from('products').insert([
                    { name: prodName, price: unitPrice, user_id: user.id }
                  ]).then();
                }
              })
              .catch(() => {});
          }
        }
      }

      if (items.length > 0) {
        if (user.receipt_quota <= 0) {
          return await envoyerTexte(phone, "⚠️ Votre solde de reçus est épuisé (0 restant). Veuillez recharger votre compte.", phoneId);
        }

        await envoyerTexte(phone, `⚡ Mode Express : ${items.length} article(s) détecté(s). Génération du reçu en cours...`, phoneId);
        return await genererEtEnvoyerRecu(phone, user, items, clientName, phoneId);
      }
    }

    if (interactiveId === 'btn_add_more') {
      return await ouvrirCatalogueVendeur(phone, user, phoneId);
    }

    if (interactiveId === 'btn_finish_cart') {
      await supabase.from('conversations').update({ step: 'SALE_CLIENT_NAME' }).eq('phone_number', phone);
      return await envoyerDemandeClient(phone, phoneId);
    }

    if (interactiveId === 'btn_client_default') {
      if (conv && conv.data) {
        const items = conv.data.items || [];
        await afficherRecuEbauche(phone, user, items, 'Client Comptoir', phoneId);
      }
      return;
    }

    if (interactiveId === 'btn_cancel_sale') {
      await supabase.from('conversations').delete().eq('phone_number', phone);
      return await envoyerTexte(phone, "❌ Vente annulée. Envoyez *VENTE* pour recommencer.", phoneId);
    }

    if (interactiveId === 'btn_validate_recu') {
      if (conv && conv.data) {
        const clientName = conv.data.client_name;
        const items = conv.data.items || [];

        if (user.receipt_quota <= 0) {
          return await envoyerTexte(phone, "⚠️ Votre solde de reçus est épuisé (0 restant). Veuillez recharger votre compte.", phoneId);
        }

        await supabase.from('conversations').delete().eq('phone_number', phone);
        await envoyerTexte(phone, "⏳ Génération de votre reçu officiel B-Ticket en cours...", phoneId);
        await genererEtEnvoyerRecu(phone, user, items, clientName, phoneId);
      }
      return;
    }

    if (interactiveId && interactiveId.startsWith('prod_')) {
      const productId = interactiveId.replace('prod_', '');
      const { data: product } = await supabase.from('products').select('*').eq('id', productId).single();

      if (product) {
        const currentItems = conv?.data?.items || [];
        await supabase.from('conversations').upsert({
          phone_number: phone,
          step: 'SALE_DETAILS',
          data: { items: currentItems, current_product: { name: product.name, unit_price: product.price } }
        });
        return await envoyerTexte(
          phone, 
          `📦 Article : *${product.name}*\n\n` +
          `Entrez la *quantité* et le *prix total convenu* (séparés par une virgule).\n` +
          `_Exemple :_ \`1, 5000\` ou simplement \`2, 10000\``, 
          phoneId
        );
      }
    }

    if (conv && conv.step === 'SALE_DETAILS') {
      let qty = 1;
      let finalPrice = 0;

      if (text.includes(',')) {
        const parts = text.split(',');
        qty = parseInt(parts[0].replace(/[^0-9]/g, ''), 10) || 1;
        finalPrice = parseInt(parts[1].replace(/[^0-9]/g, ''), 10) || 0;
      } else {
        qty = parseInt(text.replace(/[^0-9]/g, ''), 10) || 1;
        finalPrice = (conv.data.current_product.unit_price || 0) * qty;
      }

      if (isNaN(finalPrice) || finalPrice <= 0) {
        return await envoyerTexte(phone, "⚠️ Veuillez entrer un montant valide. Exemple : `2, 10000`", phoneId);
      }

      const items = conv.data.items || [];
      items.push({
        name: conv.data.current_product.name,
        qty: qty,
        total_price: finalPrice
      });

      await supabase.from('conversations').update({
        step: 'CART_MENU',
        data: { items: items }
      }).eq('phone_number', phone);

      return await envoyerBoutonsCart(phone, items, phoneId);
    }

    if (conv && conv.step === 'SALE_CLIENT_NAME') {
      const clientName = text.trim() || 'Client Comptoir';
      const items = conv.data.items || [];
      await afficherRecuEbauche(phone, user, items, clientName, phoneId);
      return;
    }

    if (textLower === 'vente' || textLower === 'menu' || textLower === '1') {
      await supabase.from('conversations').delete().eq('phone_number', phone);
      await ouvrirCatalogueVendeur(phone, user, phoneId);
    } else {
      await envoyerTexte(
        phone, 
        `Bonjour *${user.first_name}* (${user.shop_name}) !\n` +
        `Solde : *${user.receipt_quota} reçus*\n\n` +
        `⚡ *MODE EXPRESS MULTI-ARTICLES :*\n` +
        `Envoyez vos articles ligne par ligne :\n` +
        `\`Nom, Quantité, Prix Total\`\n` +
        `\`Client: Nom Client\` (optionnel)\n\n` +
        `_Exemple :_\n` +
        `Robe Wax, 1, 15000\n` +
        `Sac, 2, 20000\n` +
        `Client: Paul`, 
        phoneId
      );
    }
  }
}

// ==========================================
// ROUTES EXPRESS & WEBHOOK WHATSAPP
// ==========================================

// Verification du Webhook WhatsApp
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    console.log("✅ Webhook WhatsApp vérifié !");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Réception des événements WhatsApp
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Réponse immédiate pour respecter les contraintes Meta

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const phoneId = value?.metadata?.phone_number_id;
    const message = value?.messages?.[0];

    if (!message) return;

    const phone = message.from;
    let text = '';
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
  } catch (err) {
    console.error("Erreur Webhook POST:", err);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur B-Ticket démarré sur le port ${PORT}`);
});
              
  
