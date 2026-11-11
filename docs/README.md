# Egoscope

Egoscope est une application personnelle, à un seul utilisateur, qui cherche à savoir si certains joueurs NBA jouent mieux, ou moins bien, que d'habitude au premier match qui suit un événement public touchant leur égo. Elle repère ces événements dans la presse, fait reconstituer l'historique de chaque joueur par une recherche approfondie que l'utilisateur lance lui-même dans une IA, récupère elle-même les statistiques de match et calcule, par joueur et par type d'événement, une sensibilité chiffrée, sourcée et accompagnée d'un niveau de confiance. Elle met ensuite ces profils à l'épreuve sur chaque nouvel événement et prévient l'utilisateur sur Telegram. Tout doit être gratuit, et aucune fonction ne touche au pari.

## Avertissement

L'hypothèse qui fonde Egoscope n'est pas démontrée. Elle repose aujourd'hui sur quelques exemples mémorables, donc biaisés (D-32), et les échantillons par joueur seront petits. L'application est conçue pour la mettre à l'épreuve, pas pour la confirmer : tous les événements comptent, y compris ceux suivis d'un mauvais match ; seuls comptent les événements connus avant le match ; les cas douteux sont exclus ; une baisse de performance est mesurée comme une hausse ; et un tableau de validation confronte les profils aux cas observés en conditions réelles. Ce tableau peut très bien montrer qu'il n'y a pas d'effet : l'application doit alors le dire aussi clairement qu'elle dirait le contraire. Aucun critère d'arrêt n'est fixé (D-35).

## Ordre de lecture conseillé pour un agent de développement

Ces spécifications sont fonctionnelles : elles disent ce que l'application fait et comment le vérifier, sans choix technique ni fournisseur, à l'exception de Telegram.

1. [00 — Vue d'ensemble](00-vue-d-ensemble.md), pour le vocabulaire, le parcours de bout en bout, les objets métier et les lots.
2. [90 — Journal des décisions](90-journal-des-decisions.md), qui fait foi : il distingue les décisions de l'utilisateur (D-xx), les hypothèses de rédaction à confirmer (H-xx) et les questions ouvertes (Q-xx).
3. [14 — Exigences transverses](14-exigences-transverses.md) et [13 — Données sensibles](13-donnees-sensibles.md), dont les règles s'appliquent à toutes les fonctions.
4. Les documents du lot 1, dans l'ordre où les données circulent : 01, 02, 05, 06, 07, 08, puis 12 pour les écrans.
5. Les documents du lot 2 : 03, 04, 09, 10, 11.
6. La section « Points à trancher avant de développer », ci-dessous.

Chaque notion a un seul document propriétaire ; les autres y renvoient. Chaque exigence porte un identifiant (par exemple JOU-04) et son lot. Les hypothèses locales (par exemple H-SEN-10) sont toutes à confirmer, et les questions locales (par exemple Q-TAX-01) restent ouvertes. En cas de contradiction avec le journal, c'est le journal qui a raison.

## Documents

- [00 — Vue d'ensemble](00-vue-d-ensemble.md) : vision, hypothèse et limites, périmètre, parcours de bout en bout, objets métier, glossaire, lots.
- [01 — Joueurs suivis](01-joueurs-suivis.md) : choix et taille de la liste de 20 à 30 joueurs, identité, états, changements d'équipe et absences, fiche joueur.
- [02 — Taxonomie des événements](02-taxonomie-des-evenements.md) : fiches de type, types nets et datables, propositions et validation, évolution des types, ébauches des types candidats.
- [03 — Collecte des actualités](03-collecte-des-actualites.md) : sources de presse, collecte quotidienne, datation prudente des articles, dédoublonnage, conservation, pannes.
- [04 — Détection des événements](04-detection-des-evenements.md) : préfiltrage, classification par un modèle gratuit, regroupement des articles, aiguillage, écartement et corrections.
- [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) : demandes de backtest et couverture, texte du prompt de recherche, format JSON du résultat avec un exemple complet.
- [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) : collage du JSON, contrôles et messages d'erreur, aperçu, doublons, antériorité des sources, corrections.
- [07 — Statistiques de match](07-statistiques-de-match.md) : calendrier et feuilles de match, indice de performance, référence de saison, prochain match, quotas de la source.
- [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) : match mesuré, écart normalisé, cas douteux, profils et tendance générale, verdict et confiance, pièges d'interprétation.
- [09 — Fiche d'alerte](09-fiche-d-alerte.md) : fiche produite quand un joueur profilé vit un nouvel événement, réserves, mises à jour, historique.
- [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) : cas suivis, pronostic figé avant le match, catégorie des cas, tableau de validation.
- [11 — Notifications Telegram](11-notifications-telegram.md) : catalogue des messages, sobriété, réglages, mise en relation, échecs d'envoi.
- [12 — Interface et accès](12-interface-et-acces.md) : application web installable, écrans, liste « à faire », copier-coller sur téléphone, affichage honnête des chiffres.
- [13 — Données sensibles](13-donnees-sensibles.md) : presse publique, stockage minimal, sujets intimes, formulation des descriptions, retrait d'un événement.
- [14 — Exigences transverses](14-exigences-transverses.md) : gratuité et quotas, critères de choix des services, tâches planifiées, paramètres, journal, sauvegarde, sécurité, déploiement pas à pas.
- [90 — Journal des décisions](90-journal-des-decisions.md) : décisions, hypothèses et questions ouvertes du cadrage ; il fait foi.

## Les deux lots

Le découpage en deux lots est une hypothèse de rédaction, à confirmer (H-12). Chaque exigence indique son lot.

- **Lot 1 — l'application minimale** (D-22) : joueurs suivis, taxonomie, demande de backtest déclenchée à la main, prompt de recherche, import du JSON, statistiques, calcul de sensibilité, consultation des profils. Il fonctionne seul et permet déjà de confronter l'hypothèse à l'historique.
- **Lot 2 — la veille et l'épreuve des faits** : collecte et détection quotidiennes, demandes de backtest nées des détections, fiche d'alerte, suivi automatique des matchs, tableau de validation, notifications Telegram.

## Points à trancher avant de développer

Les questions suivantes sont les plus structurantes. Les premières décident de la faisabilité même de l'application gratuite ; les suivantes ont une valeur par défaut qui permet de commencer, mais elles pèsent sur les résultats.

- **Services gratuits** (Q-02) : hébergeur, base, modèle de langage, source de statistiques et flux ne sont pas choisis ; les critères sont dans [14 — Exigences transverses](14-exigences-transverses.md).
- **Couverture de la source de statistiques** (Q-STA-01) : si aucune source gratuite ne fournit tout le Game Score sur toute une carrière, faut-il accepter des profils partiels ou revoir l'indicateur ? Voir [07 — Statistiques de match](07-statistiques-de-match.md).
- **IA de recherche gratuite et son quota** (Q-BKT-02) : il dit si 20 à 30 backtests, puis leurs compléments, sont réalistes. Voir [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md).
- **Niveau technique de l'utilisateur** (Q-01) : il règle le degré de détail du déploiement. Voir [14 — Exigences transverses](14-exigences-transverses.md).
- **Liste initiale des joueurs** (Q-03) : aucun joueur n'est désigné. Voir [01 — Joueurs suivis](01-joueurs-suivis.md).
- **Seuils du verdict** (Q-04) et **profils nombreux** (Q-VUE-01) : les valeurs par défaut et le risque de verdicts dus au hasard sont dans [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) et [00 — Vue d'ensemble](00-vue-d-ensemble.md).
- **Heure de la détection quotidienne** (Q-SUI-02) : elle fixe la part des cas qui testent vraiment l'hypothèse. Voir [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md).
- **Types connus d'avance** (Q-TAX-01) : anniversaire et match contre l'ancienne équipe, à repérer dans la presse ou à déduire du calendrier. Voir [02 — Taxonomie des événements](02-taxonomie-des-evenements.md).
- **Types liés à un facteur parasite** (Q-SEN-01) : le record négatif à éviter se joue presque toujours dans un match à fort enjeu. Voir [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md).
- **Événements peu sûrs** : poids d'un événement de confiance de la recherche faible (Q-BKT-01, [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md)) et sort d'une source datée du jour du match sans heure (Q-IMP-01, [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md)) ; les réponses par défaut sont dans [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md).
- **Empreinte d'un événement retiré** (Q-DSN-01) : sans elle, un nouvel import peut réintroduire un événement retiré. Voir [13 — Données sensibles](13-donnees-sensibles.md).
- **Emplacement des sauvegardes** (Q-TRV-01) : un espace gratuit et privé hors de la base peut ne pas exister. Voir [14 — Exigences transverses](14-exigences-transverses.md).

S'y ajoutent les hypothèses de rédaction, toutes à confirmer ; les plus lourdes sont le découpage en lots (H-12), la formule de l'indicateur de performance (H-13) et le seuil de 5 cas valides pour un verdict par joueur (H-03).
