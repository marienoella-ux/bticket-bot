# B-Ticket — Contexte pour Claude Code

## Ce que c'est

B-Ticket est un bot WhatsApp qui transforme une vente déclarée en quelques secondes en un reçu professionnel, pour les vendeurs informels au Cameroun (marché, mode, restauration/livraison, accessoires). C'est un produit propriétaire de Brainiacs (agence basée à Yaoundé), positionné comme la **"caisse de poche"** — délibérément plus simple qu'un ERP complet.

**Positionnement concurrentiel** : Geskap (concurrent basé à Douala/Yaoundé, gratuit jusqu'à 100 ventes/mois, ERP complet) fait déjà tout ce qu'un logiciel de gestion peut faire. B-Ticket ne cherche pas à rivaliser sur ce terrain — pas de gestion de stock formelle, pas de module RH, pas de comptabilité complexe. La valeur de B-Ticket est la vitesse et la simplicité extrême pour un vendeur qui n'a ni le temps ni l'usage d'un outil lourd.

## Stack technique — ne pas dévier sans discussion explicite

- **Backend** : Node.js + Express, un seul fichier `index.js`
- **Hébergement** : Render (service web "Starter", toujours actif)
- **Base de données** : Supabase (Postgres + Storage pour les logos)
- **Messagerie** : API Cloud WhatsApp de Meta, **en accès direct** (pas de BSP payant comme Twilio/360dialog) — Plan B "bot compagnon" sur numéro dédié, la Coexistence WhatsApp n'est pas utilisée
- **Versioning** : GitHub

## Tables Supabase

- `users` — phone_number (clé), first_name, shop_name, logo_url, receipt_quota, is_approved, language, last_free_credit_month. ⚠️ Pas de colonne `id`.
- `products` — id (clé primaire auto-générée), user_phone (identifie le vendeur propriétaire), name, price. Les deux colonnes `id` et `user_phone` coexistent et sont toutes les deux légitimes — ne pas supposer qu'une seule des deux existe.
- `sales` — id, user_id (contient en fait le phone_number du vendeur, malgré le nom de la colonne), client_name, total_amount, items (jsonb), created_at
- `conversations` — phone_number (clé), step, data (jsonb) — état de la conversation en cours
- `recharge_requests` — id, phone_number, payer_name, amount, status

## Bug récurrent à ne JAMAIS réintroduire

`users` n'a **pas** de colonne `id`. Le champ clé est `phone_number`. Ce bug (`user.id` au lieu de `user.phone_number`, ou `.eq('id', ...)` au lieu de `.eq('phone_number', ...)` sur la table `users` précisément) s'est produit au moins 4 fois dans l'historique du projet — dans la mise à jour du quota, le changement de langue, l'insertion des ventes, l'enregistrement des produits. **Avant tout commit touchant `users`, vérifier explicitement qu'aucun `.id` n'a été utilisé par erreur sur cette table.**

Ne pas confondre avec `products`, qui a bien sa propre colonne `id` (légitime, voir ci-dessus), ni avec `sales.user_id`, qui malgré son nom contient un `phone_number`.

## Identité visuelle du reçu — fixée, ne pas réinventer sans validation

- Couleurs : encre `#015E54`, ambre `#F2A63A`, papier `#FBF6EC`, gris texte `#4B6660`
- Police des titres : Georgia/serif ; police des montants : ui-monospace
- Format du reçu généré : **A4 portrait, ratio 1:1.4142**, rendu en haute résolution (canvas 960px de large, soit x2)
- Le footer (signature "Fait avec B-Ticket · un produit Brainiacs" + pictogramme Brainiacs) doit **toujours être ancré à une distance fixe du bas de la page** (`height - FOOTER_RESERVE`), jamais calculé depuis la fin du contenu
- Le pictogramme Brainiacs est encodé en base64 dans le code (`BRAINIACS_ICON_B64`) — son chargement doit toujours être protégé par un `try/catch` qui ne fait jamais échouer toute la génération du reçu si l'icône est indisponible

## Logique produit à respecter

- **Quota** : 15 reçus gratuits offerts à l'approbation, puis 15 supplémentaires chaque 1er du mois — déclenché **manuellement** par l'admin via la commande `CREDITS` dans WhatsApp, pas par un cron automatique (choix délibéré : garde un point de contrôle humain tant que le volume est faible)
- **Onboarding** : prénom → nom de boutique → catalogue (optionnel) → logo (optionnel) → tout est écrit en base **en une seule fois à la fin**, jamais avant que l'inscription soit complète (évite qu'un utilisateur "à moitié inscrit" ne casse le routage)
- **Admin** : aucune notification poussée par le bot pour les inscriptions ou recharges (coûte de l'argent et peut échouer hors fenêtre des 24h WhatsApp) — l'admin consulte activement via la commande `ATTENTE`, qui affiche une liste interactive avec boutons de validation en un tap
- **Recharge** : le vendeur envoie *nom du payeur, montant* après paiement au code marchand Orange Money ; l'admin sélectionne la demande dans `ATTENTE`, voit le calcul automatique en crédits (montant ÷ `TARIF_REF_FCFA`), confirme d'un tap
- **Catalogue** : le vendeur peut négocier un prix différent du prix catalogue à la vente (jamais écrit dans `products`, seulement dans `sales.items`) ; le catalogue peut aussi s'auto-alimenter depuis le Mode Express

## Règles de travail pour Claude Code

1. **Ne jamais faire de refactoring large, de renommage de variables, ou de réorganisation du fichier sans qu'on te le demande explicitement.** Une demande de correctif ciblé reste un correctif ciblé — ne touche pas au reste du fichier même si tu identifies une amélioration possible ailleurs ; signale-la plutôt en fin de réponse.
2. **Avant toute modification, relis entièrement le fichier concerné** pour repérer d'éventuels doublons de fonctions, de blocs `if (conv.step === ...)`, ou de déclarations de variables — l'historique du projet contient plusieurs bugs causés par des blocs dupliqués lors de modifications précédentes non faites avec toi.
3. **Ne supprime aucune fonctionnalité existante** sans confirmation explicite, même si elle te semble redondante ou mal écrite.
4. **Ne change jamais la stack technique** (Render, Supabase, API Meta directe) ni l'identité visuelle du reçu de ta propre initiative.
5. **Après chaque modification, relis le fichier une dernière fois** pour vérifier l'absence d'erreur de syntaxe évidente (accolades, virgules, variables utilisées avant déclaration) avant de considérer la tâche terminée.
6. Les décisions de produit, de design, et de priorité sont prises en dehors de ce dépôt — tu exécutes ce qu'on te demande précisément, tu ne réinterprètes pas l'intention derrière une demande pour "faire mieux" de ton propre chef.
7. Avant de signaler quelque chose comme un bug, vérifie que ça en est vraiment un plutôt que de supposer la structure d'une table — en cas de doute sur le schéma réel d'une table Supabase, demande confirmation plutôt que d'agir sur une hypothèse.
