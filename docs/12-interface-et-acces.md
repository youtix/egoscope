# 12 — Interface et accès

## Objet

Ce document décrit ce que l'utilisateur voit et manipule : une application web adaptée au téléphone et installable sur celui-ci (D-25), protégée par un accès à compte unique (H-10) et entièrement en français (H-11). L'utilisateur s'en sert surtout sur son téléphone. Le document fixe la navigation et les écrans (but, contenu, actions), le parcours « copier le prompt, le lancer ailleurs, coller le résultat », l'affichage honnête des chiffres, les états vides et le premier parcours guidé, le comportement hors connexion, l'accessibilité de base et la répartition entre les deux lots. Il possède aussi le réglage du fuseau horaire de l'utilisateur (IHM-14) et le comportement hors connexion (IHM-57, IHM-58), auxquels les autres documents renvoient. Les règles métier affichées appartiennent aux autres documents, vers lesquels chaque écran renvoie.

## Décisions d'origine

- **D-02** — Un seul utilisateur.
- **D-05** — Résultat chiffré et sourcé.
- **D-08**, **Q-05** — Aucun pari, aucune cote.
- **D-09** — L'utilisateur exécute lui-même le prompt dans une IA de recherche approfondie, puis rapporte le résultat à l'application.
- **D-11** — Deux niveaux d'analyse, avec un niveau de confiance affiché.
- **D-12** — L'utilisateur valide les types d'événements.
- **D-14** — Le résultat de recherche revient en JSON strict.
- **D-16** — Verdict à trois niveaux : probable, possible, non concluant.
- **D-18**, **D-22** — Une vraie application, minimale d'abord.
- **D-20** — Stockage minimal.
- **D-25** — Application web adaptée au mobile, de type PWA, installable sur le téléphone.
- **D-29**, **D-30**, **D-35** — Fiche d'alerte, Telegram, tableau de validation.
- **D-36** — Backtests au fil des détections : l'échéance du prochain match compte.
- **H-04** — Sensibilités positive et négative affichées au même titre.
- **H-08** — L'utilisateur peut écarter un événement détecté.
- **H-09** — Le contexte d'un cas est corrigeable par l'utilisateur.
- **H-10** — Authentification minimale pour un utilisateur unique.
- **H-11** — Interface en français.
- **H-12** — Deux lots.
- **Q-01** — Niveau technique de l'utilisateur inconnu : l'interface doit s'expliquer d'elle-même.

## Périmètre

Ce document couvre : l'application installable et sa mise en page ; l'accès protégé ; la langue, les heures et les formats ; la navigation et les écrans ; le parcours de copier-coller sur téléphone ; l'affichage honnête des chiffres ; les états vides et le parcours guidé ; le hors connexion ; l'accessibilité ; la répartition par lot.

Il ne couvre pas, et renvoie à :

- le contenu de la fiche joueur et les actions sur les joueurs : [01 — Joueurs suivis](01-joueurs-suivis.md) ;
- le contenu des fiches de type, leur cycle de vie et le prompt d'exploration : [02 — Taxonomie des événements](02-taxonomie-des-evenements.md) ;
- les sources de presse et leurs pannes : [03 — Collecte des actualités](03-collecte-des-actualites.md) ;
- la détection, la confiance de détection et les motifs d'écartement : [04 — Détection des événements](04-detection-des-evenements.md) ;
- la demande de backtest, son échéance, le texte du prompt et le format JSON : [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) ;
- les contrôles d'import, les messages d'erreur, l'aperçu, la fusion et les corrections : [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) ;
- les statistiques et le prochain match : [07 — Statistiques de match](07-statistiques-de-match.md) ;
- toutes les règles de calcul : [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) ;
- le contenu de la fiche d'alerte : [09 — Fiche d'alerte](09-fiche-d-alerte.md) ;
- le contenu du tableau de validation : [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) ;
- les messages Telegram et leurs réglages : [11 — Notifications Telegram](11-notifications-telegram.md) ;
- les données sensibles et le retrait d'un événement : [13 — Données sensibles](13-donnees-sensibles.md) ;
- la liste des paramètres, le journal, la sauvegarde, l'installation et les règles de sécurité d'accès (mot de passe, blocage, durée de session) : [14 — Exigences transverses](14-exigences-transverses.md).

## Acteurs et déclencheurs

Acteur : l'utilisateur unique, surtout sur son téléphone, parfois sur un ordinateur.

Points d'entrée : l'icône de l'application installée ; l'adresse de l'application dans un navigateur ; au lot 2, un lien reçu sur Telegram.

Déclencheurs d'affichage : ouverture de l'application ; retour dans l'application après un passage dans une autre, typiquement l'IA de recherche ; retour de la connexion réseau ; rafraîchissement demandé ; nouvelles données produites par les tâches planifiées (statistiques, détection).

## Parcours

Scénario nominal, du joueur à son premier profil (lot 1) :

1. L'utilisateur ouvre Egoscope depuis l'icône de son téléphone ; sa session est encore ouverte.
2. Il ouvre « Joueurs », la fiche du joueur A, et touche « Demander un backtest » (document 05).
3. L'écran de la demande s'affiche. Il touche « Copier le prompt » ; l'application confirme la copie et en note l'heure.
4. Il passe dans son application d'IA, colle le prompt, lance la recherche approfondie, puis copie la réponse complète.
5. Il revient dans Egoscope : l'écran est tel qu'il l'a laissé, et l'accueil affiche le bandeau « Backtest en cours : le joueur A — Coller le résultat ».
6. Il touche « Coller le résultat » : l'écran d'import s'ouvre, rattaché à la demande. Il colle ; le texte est aussitôt gardé en brouillon.
7. Il touche « Vérifier » : l'aperçu présente les événements trouvés, les avertissements et les erreurs (document 06).
8. Sans erreur bloquante, il touche « Enregistrer » ; la demande passe à « importée ».
9. L'application récupère les statistiques et calcule les profils (documents 07 et 08) ; l'écran montre l'avancement.
10. Il consulte la fiche du joueur A, puis le détail d'un profil et la liste de ses cas.

Variantes :

- **Premier lancement** : un guide de démarrage conduit jusqu'au premier profil (IHM-53).
- **Résultat erroné** : il touche « Copier le message de correction », le colle dans sa conversation avec l'IA, récupère une version corrigée et recommence l'import (IHM-43).
- **Session expirée pendant l'aller-retour** : après reconnexion, il retrouve l'écran d'import et son brouillon (IHM-11, IHM-42).
- **Application fermée par le téléphone en arrière-plan** : à la réouverture, même écran, même brouillon (IHM-41, IHM-42).
- **Hors connexion** : il consulte ce qui est déjà chargé et peut copier un prompt ; ses saisies sont conservées jusqu'au retour du réseau (IHM-57, IHM-58).
- **Lot 2, depuis Telegram** : le lien ouvre directement la fiche d'alerte ou la demande, après connexion si nécessaire.
- **Lot 2, écarter un événement** : depuis la fiche d'alerte ou la liste des événements détectés, avec l'annonce des conséquences avant confirmation (IHM-32).
- **Retirer un événement** : depuis sa fiche, par un écran distinct qui annonce ce qui disparaîtra et les limites du retrait (IHM-68).
- **Explorer de nouveaux types** : même aller-retour, avec le prompt d'exploration du document 02 (IHM-31).

## Règles de gestion

### Application installable et mise en page

- **IHM-01** [Lot 1] — L'application est conçue d'abord pour le téléphone : une colonne, aucun défilement horizontal pour le contenu courant, actions principales atteignables au pouce. Elle reste pleinement utilisable sur ordinateur.
- **IHM-02** [Lot 1] — Elle est installable sur le téléphone (D-25) : nom « Egoscope », icône, ouverture en plein écran sans barre du navigateur, démarrage sur l'accueil. Une page d'aide explique l'installation selon le navigateur du téléphone.
- **IHM-03** [Lot 1] — Quand une nouvelle version est disponible, un bandeau propose de recharger ; le rechargement ne fait perdre aucun brouillon.
- **IHM-04** [Lot 1] — À chaque ouverture ou retour dans l'application, les données affichées se rafraîchissent si la connexion le permet ; l'accueil s'affiche d'abord avec les dernières données connues, puis se met à jour.

### Accès protégé

- **IHM-05** [Lot 1] — **Compte unique** (H-10) : pas d'inscription ni de création de compte depuis l'interface. Le compte, son mot de passe initial et les règles de sécurité (longueur du mot de passe, blocage après des échecs, durée de session, réinitialisation) relèvent du document 14 (TRV-57 à TRV-63) : les écrans de ce document les appliquent sans en fixer les valeurs. Aucun écran, aucune donnée et aucun lien, y compris ceux des messages Telegram, n'est accessible sans authentification (TRV-58).
- **IHM-06** [Lot 1] — **Connexion** : un seul champ, le mot de passe, qu'on peut afficher en clair et que le gestionnaire de mots de passe du téléphone peut remplir. À la première connexion, faite avec le mot de passe initial de la configuration, seul l'écran « Choisir votre mot de passe » s'ouvre, jusqu'à ce qu'il soit remplacé (TRV-57). La session reste ouverte sur l'appareil pour la durée fixée par TRV-62. Plusieurs appareils peuvent être connectés en même temps (H-IHM-06).
- **IHM-07** [Lot 1] — **Échecs** : quand la connexion est bloquée après des échecs répétés (TRV-61), l'écran de connexion le dit, indique jusqu'à quand et n'examine aucun mot de passe pendant ce temps. Les échecs et le blocage sont inscrits au journal d'activité ; au lot 2, le blocage est notifié (TEL-15).
- **IHM-08** [Lot 1] — **Déconnexion** : depuis les réglages, sur cet appareil ou sur tous. Elle efface les données gardées sur l'appareil ; si un brouillon n'est pas enregistré, l'application prévient d'abord.
- **IHM-09** [Lot 1] — **Mot de passe** : il se change dans les réglages, l'ancien étant exigé ; l'écran rappelle la longueur minimale (TRV-60) et annonce que les autres sessions seront fermées (TRV-60). En cas d'oubli, il se réinitialise par la procédure de TRV-63 ; il n'existe pas de récupération par courriel.
- **IHM-10** [Lot 1] — Les échanges passent uniquement par une connexion chiffrée ; les adresses des écrans ne contiennent ni mot de passe ni jeton d'accès.
- **IHM-11** [Lot 1] — Après une connexion, y compris après une expiration de session, l'utilisateur arrive sur l'écran qu'il voulait ouvrir, avec ses brouillons intacts.

### Langue, heures et formats

- **IHM-12** [Lot 1] — Tout est en français (H-11) : libellés, messages, erreurs, aide. Les titres d'articles et les noms propres restent dans leur langue d'origine ; le prompt s'affiche tel que le produit le document 05.
- **IHM-13** [Lot 1] — Formats français : dates abrégées (« mer. 18 nov. »), heures sur 24 heures (« 1 h 30 »), virgule décimale, signe toujours explicite (+0,62, −0,40), nombre de décimales fixé par le document propriétaire de chaque valeur (STA-12 pour l'indice de performance, SEN-09 pour les écarts normalisés).
- **IHM-14** [Lot 1] — **Fuseau horaire** : un réglage fixe le fuseau de l'utilisateur (heure de Paris par défaut, H-IHM-02), utilisé pour toutes les heures affichées et par les notifications (document 11). Les heures de match y sont converties en tenant compte des changements d'heure, qui ne tombent pas aux mêmes dates en Europe et aux États-Unis. Quand la date locale diffère de celle du match aux États-Unis, celle-ci est rappelée (« mer. 18 nov. à 1 h 30 — mardi soir aux États-Unis »). Si le fuseau du téléphone diffère du réglage, l'application propose de l'adopter.
- **IHM-15** [Lot 1] — Les termes du glossaire (document 00) affichés à l'écran (écart normalisé, cas valide, verdict, tendance générale…) donnent accès, d'un toucher, à leur définition en une phrase. Les états s'affichent avec les libellés des états communs du document 00 (VUE-08).

### Navigation

- **IHM-16** [Lot 1] — Une barre de navigation permanente se trouve en bas de l'écran sur téléphone, sur le côté sur grand écran (H-IHM-01). Au lot 1 : Accueil, Joueurs, Types, Plus. Au lot 2 : Accueil, Joueurs, Alertes, Types, Plus. « Plus » ouvre : Demandes de backtest, Réglages, État de l'application, Journal d'activité, Méthode et limites, Aide, et au lot 2 Événements détectés, Tableau de validation, Collecte et détection. L'entrée Accueil porte le nombre d'éléments « à faire ».
- **IHM-17** [Lot 1] — Tout objet cité (joueur, type, événement, cas, demande, fiche d'alerte, source) mène à son écran. Le retour arrière ramène à l'écran précédent, à la même position de défilement.
- **IHM-18** [Lot 1] — Les longues listes se chargent par tranches (paramétrable, 50 éléments, H-IHM-03) et se filtrent par état ; une recherche par nom de joueur ou de type est proposée là où la liste peut être longue.

### Écrans

#### Accueil et liste « à faire »

- **IHM-19** [Lot 1] — **But** : savoir d'un coup d'œil ce qui attend l'utilisateur. **Affiche**, dans cet ordre : le bandeau « demande en cours » (IHM-40) ; les bandeaux système (nouvelle version ; au lot 2, liaison Telegram rompue ou messages en échec) ; la liste « à faire » (IHM-20) ; au lot 2, les fiches d'alerte ouvertes, la plus proche du coup d'envoi en premier ; la date de la dernière mise à jour des statistiques et, au lot 2, de la dernière détection. **Actions** : ouvrir chaque élément, rafraîchir.
- **IHM-20** [Lot 1] — La liste « à faire » regroupe ce qui attend une action de l'utilisateur, en rubriques présentées dans l'ordre ci-dessous ; chaque rubrique suit les règles de son document propriétaire ; une rubrique vide disparaît et, si tout est vide, l'accueil affiche « Rien à faire pour le moment » :
  - les demandes de backtest « à faire », dans l'ordre fixé par le document 05 (BKT-17, BKT-18) : au lot 2, les demandes urgentes d'abord, de l'échéance la plus proche à la plus lointaine, puis les autres, de la plus ancienne à la plus récente. Chacune montre le joueur, son déclencheur et sa nature (document 05), l'échéance en heure locale avec le temps restant, la mention « échéance proche » sous un délai (paramétrable, 24 h, H-IHM-03), pour un événement dont le match est déjà joué la mention de BKT-18 (le backtest arrivera après coup, D-36), l'indication « prompt copié » s'il y a lieu et l'avertissement d'un prompt fondé sur une version antérieure d'une fiche (TAX-23) ;
  - les demandes complémentaires proposées et pas encore acceptées (BKT-05, BKT-06, TAX-20, TAX-24) ;
  - les incidents en cours, avec leur date de début et leur conséquence : source de statistiques indisponible, quota atteint, tâche non exécutée, sauvegarde en échec, et au lot 2 source de presse en panne ou muette, collecte impossible, liaison Telegram rompue, blocage de la connexion ; un incident peut être masqué : il reste dans le journal et un compteur « incidents masqués » subsiste tant qu'il dure ;
  - les joueurs : invitation à en ajouter tant qu'aucun n'est suivi (JOU-06), rappel sous le minimum indicatif (JOU-04), correspondances statistiques à établir avec leurs nouveaux candidats (JOU-10, STA-03), suggestions de pause (JOU-22) ;
  - les types d'événements « proposés », à valider ou rejeter (document 02), du plus ancien au plus récent ;
  - les événements et les cas à examiner : événements à requalifier (TAX-25) ou à répartir (TAX-29), cas signalés pour revue (SEN-16) et, au lot 2, événements marqués « datation à vérifier » (DET-32, SEN-45).

#### Joueurs suivis

- **IHM-21** [Lot 1] — **But** : voir tous les joueurs et leur état. **Affiche**, pour chaque joueur : nom, équipe, état (actif, en pause, retiré — document 01), état du backtest (jamais demandé, demande à faire, importé le…), nombre total de cas valides (JOU-28), prochain match. Les joueurs actifs s'affichent par défaut ; un filtre montre les autres. **Actions** : ouvrir une fiche joueur, ajouter un joueur (IHM-66).
- **IHM-66** [Lot 1] — **Ajout d'un joueur. But** : inscrire un joueur suivi sans erreur d'identité. **Affiche** les critères de choix et le nombre de joueurs actifs rapporté au maximum (JOU-01, JOU-04), les champs d'identité (JOU-08), puis les candidats trouvés dans la source de statistiques, chacun avec son nom, ses équipes et ses saisons, parmi lesquels l'utilisateur confirme le bon (JOU-10, STA-03) ; une variante de nom partagée avec un autre joueur suivi est signalée (JOU-09). Si aucun candidat ne convient ou si la source est indisponible, le joueur est enregistré avec la mention « correspondance à établir », et les nouveaux candidats arrivent dans la liste « à faire » (IHM-20). Un ajout au-delà du maximum est refusé avec les issues de JOU-05.

#### Fiche joueur

- **IHM-22** [Lot 1] — **But** : tout savoir d'un joueur. **Affiche** les informations définies par le document 01 (JOU-25, JOU-26), puis : le prochain match ; la référence de saison (moyenne, écart-type, nombre de matchs, document 07) ; le bloc backtest (demandes passées et en cours, couverture par type et par période, BKT-10, historique des imports, IMP-31, refus restants du dernier import, IMP-24) ; le bloc profils (IHM-23) ; les événements du joueur, historiques et détectés, avec l'état de leur cas, chacun menant à sa fiche (IHM-67) ; au lot 2, ses fiches d'alerte. **Actions**, selon l'état du joueur (JOU-27) : demander un backtest, avec pour un joueur déjà traité le choix « compléter » ou « refaire » (BKT-01) ; accepter un complément proposé (BKT-05, BKT-06) ; forcer la récupération de ses statistiques (STA-44) ; modifier son identité (JOU-12) ; mettre en pause, réactiver, retirer (document 01) ; pour un joueur retiré, supprimer ses données après l'annonce de ce qui disparaîtra et une double confirmation (JOU-24).
- **IHM-23** [Lot 1] — Le bloc profils présente une ligne par type validé, dans l'ordre de la taxonomie, sans jamais filtrer par verdict. Chaque ligne donne le verdict, le sens, l'écart moyen avec sa fourchette et le nombre de cas valides (historiques et suivis), et la confiance du profil ; ou, sous le seuil, « non concluant pour ce joueur (2 cas valides sur 5 nécessaires) » avec la tendance générale du type sous le titre « tendance générale du type, ne décrit pas ce joueur » (SEN-31) ; et, le cas échéant, « type non couvert par le backtest » et les autres avertissements de SEN-46. Les profils archivés d'un joueur retiré ou d'un type retiré sont présentés à part, avec la mention « archivé » (SEN-19). Une ligne de synthèse compte les profils par verdict, ceux sous le seuil et les types non couverts.

#### Détail d'un profil

- **IHM-24** [Lot 1] — **But** : vérifier d'où vient un verdict, pour un joueur et un type. **Affiche** : le résumé du profil (document 08), avec ses contrôles et avertissements (SEN-27, SEN-43, SEN-46) et le nombre d'événements sortis du décompte (SEN-33), et la tendance générale du type ; le seuil de cas en vigueur et la date du dernier calcul ; la liste des cas en groupes : cas valides, cas exclus avec leur motif (D-19), cas non mesurables avec leur motif et cas en attente du match avec leur motif (SEN-07). Chaque cas montre la date de l'événement, une description courte, son origine (« historique » ou « suivi »), le match mesuré (date, adversaire), l'indice de performance et l'écart normalisé. **Actions** : filtrer par origine ; ouvrir un cas.
- **IHM-25** [Lot 1] — Le détail d'un cas montre en plus : les sources de l'événement avec leurs liens ; le calcul de l'écart avec ses trois nombres (indice du match, moyenne et écart-type de saison) ; les minutes jouées ; les indications de contexte avec leur origine (recherche, classification, calcul ou utilisateur, H-09) ; les critères de cas douteux retenus, les signalements pour revue et les décisions manuelles (SEN-18). **Actions** : ouvrir une source ou la fiche de l'événement (IHM-67) ; exclure le cas ou le réintégrer (SEN-17), avec un motif choisi dans la liste fermée de SEN-17 et le commentaire qu'elle exige, l'écran rappelant qu'aucun motif ne porte sur la performance ; corriger l'événement ou son contexte, ou le retirer, depuis sa fiche (IHM-67, IHM-68).

#### Fiche d'un événement et retrait

- **IHM-67** [Lot 1] — **Fiche d'un événement. But** : vérifier un événement et le corriger. **Affiche**, pour tout événement : le joueur, le type et la version de fiche sous laquelle il a été qualifié (TAX-23), la date de référence et sa précision, la description, les sources avec leurs liens, les indications de contexte avec leur origine, l'état de son cas et l'historique des corrections. Pour un événement historique, en plus : la confiance de la recherche (document 05), la réserve « non vérifié », les avertissements d'import, l'antériorité (IMP-18) et l'import d'origine (IMP-31). Au lot 2, pour un événement détecté : la confiance de détection, les articles rattachés et l'article de référence, avec pour chacun le résultat de classification qui l'a rattaché (DET-53), et les marques « datation à vérifier » et « détecté après le coup d'envoi » (DET-32, DET-33). **Actions** : corriger l'événement selon IMP-32 (historique) ou DET-47 et DET-48 (détecté) ; supprimer un événement historique avec un motif (IMP-33), l'écran rappelant qu'on ne supprime jamais un événement à cause du match qui l'a suivi ; écarter ou réintégrer un événement détecté (IHM-32) ; lever la marque « datation à vérifier » (DET-32) ; retirer l'événement (IHM-68).
- **IHM-68** [Lot 1] — **Retrait d'un événement** (DSN-26 à DSN-28). Depuis la fiche de tout événement, « Retirer » ouvre un écran distinct de l'écartement et de la suppression, qui explique qu'un retrait est un effacement définitif pour une raison de sensibilité, jamais à cause du match qui a suivi, affiche ce qui va disparaître (DSN-27), en indique les limites, telles que les fixe DSN-28 (par exemple un message Telegram que l'application ne parvient plus à supprimer, TEL-38, ou une sauvegarde pas encore renouvelée), et demande une confirmation explicite. Après le retrait, aucun écran ne mentionne l'événement ; seul le compteur global de DSN-29 augmente.

#### Demandes de backtest

- **IHM-26** [Lot 1] — **But** : retrouver toutes les demandes. **Affiche** les demandes par état (à faire, importée, annulée — document 05), la plus récente d'abord, avec le joueur, le déclencheur et l'échéance. **Action** : ouvrir une demande.
- **IHM-27** [Lot 1] — **Écran d'une demande. But** : lancer la recherche dans de bonnes conditions. **Affiche** : le joueur ; le déclencheur et la nature de la demande (document 05 : action manuelle, validation d'un type, import incomplet ou, au lot 2, détection, avec un lien vers l'événement ; demande initiale, complément ou reprise complète) ; son état ; l'échéance (prochain match en heure locale et temps restant, BKT-16) et, au lot 2, pour chaque événement rattaché, son match « à venir » ou « joué » (BKT-18) ; les types demandés et leurs périodes ; un mode d'emploi en quatre étapes (copier ; coller dans l'IA et lancer la recherche approfondie ; copier la réponse complète ; revenir et coller) ; le texte du prompt, replié, avec « tout afficher » ; l'indication « prompt copié le … à … » et, si le prompt a changé depuis, l'avertissement que le texte copié n'est plus à jour (BKT-20). **Actions** : « Copier le prompt », bouton principal ; « Partager », par la fonction de partage du téléphone quand elle existe ; « Mettre à jour » et « Réduire » la demande, le prompt étant régénéré sous la même référence (BKT-15) ; « Ouvrir l'outil de recherche » si son adresse est réglée (IHM-44) ; « Coller le résultat » ; « Annuler la demande », avec confirmation et motif facultatif (BKT-14).

#### Import d'un résultat de recherche

- **IHM-28** [Lot 1] — **But** : coller le JSON et l'enregistrer sans erreur. **Affiche** : en tête, la demande et le joueur concernés ; une grande zone de collage où la correction automatique, la ponctuation intelligente et la majuscule automatique sont désactivées (IMP-02), avec un bouton « Coller » qui insère le contenu du presse-papiers quand le téléphone l'autorise, et qui explique sinon l'appui long ; le choix d'un fichier texte, à défaut de collage (IMP-02) ; le nombre de caractères reçus et la fin du texte, pour vérifier que tout a été copié (IMP-02) ; l'état du brouillon (« brouillon gardé à … »). **Actions** : « Vérifier », « Effacer », « Abandonner le brouillon ».
- **IHM-29** [Lot 1] — Après « Vérifier », l'écran présente l'aperçu défini par le document 06 (IMP-22, IMP-23, IMP-37) : décompte, mode d'import, couverture et manques, répartition par type et par saison, antériorité, liste des événements (date, type, description courte, sources), doublons et fusions annoncés, refus, avertissements, pistes et limites, joueur du résultat mis en regard de celui de la demande, sondage des sources. Les erreurs bloquantes viennent en tête, puis les avertissements, chacun avec le message du document 06, qui désigne l'endroit concerné et la correction attendue (IMP-20). « Enregistrer » reste inactif tant que le résultat entier est refusé (IMP-09) ; des événements refusés n'empêchent pas d'enregistrer les autres, après l'avertissement d'import partiel (IMP-24). « Copier le message de correction » est proposé (IHM-43).
- **IHM-30** [Lot 1] — Après l'enregistrement, l'écran affiche le bilan du document 06 (IMP-35), avec le complément proposé (BKT-06) et les refus restants (IMP-24), montre l'avancement de la récupération des statistiques et du calcul tel que le présente le document 07 (STA-41, par exemple « 9 saisons sur 14 »), signale au lot 2 la fiche d'alerte produite pour un événement en attente dès qu'elle existe (ALE-05), et mène à la fiche joueur. Si une source à quota freine le calcul, l'écran le dit et indique quand il reprendra (STA-41).

#### Taxonomie et fiches de type

- **IHM-31** [Lot 1] — **But** : gérer les types d'événements. **Affiche** les types par état (validé, proposé, rejeté, retiré — document 02), avec leur nombre. La fiche d'un type présente sa définition, ses critères d'inclusion et d'exclusion, sa règle de datation, son exemple et ses points de vigilance (TAX-01), son origine, ses dates, l'historique de ses versions avec leurs compteurs (TAX-26), et la tendance générale du type (document 08) avec son nombre de cas et de joueurs, présentée comme archivée pour un type retiré (SEN-19). **Actions**, selon le document 02 : valider avec la liste de contrôle (TAX-12), rejeter avec un motif, rouvrir, modifier en qualifiant la modification, fusionner, scinder, retirer, réactiver ; à la validation, l'écran propose les demandes complémentaires prévues (TAX-20, BKT-05). « Explorer de nouveaux types » ouvre le même aller-retour que la demande de backtest : prompt d'exploration à copier, résultat à coller, aperçu des propositions (document 02).

#### Événements détectés

- **IHM-32** [Lot 2] — **But** : contrôler ce que la détection a trouvé et écarter les erreurs. **Affiche**, du plus récent au plus ancien, avec des filtres par état (détecté, écarté), joueur et type : le joueur, le type, la date de référence, la source principale (média, date et heure), la confiance de détection, de 0 à 100 (DET-16), les marques « datation à vérifier » et « détecté après le coup d'envoi » (DET-32, DET-33), ce que l'événement a déclenché (fiche d'alerte, demande de backtest) et l'état de son cas. Le détail est la fiche de l'événement (IHM-67). **Actions** : « Écarter » (H-08), avec un motif choisi selon le document 04 (DET-43) ; avant confirmation, l'écran rappelle qu'un écartement corrige une erreur de détection et ne dépend jamais du résultat du match (DET-46, H-01), qu'un mauvais joueur, un mauvais type ou un doublon se corrigent plutôt que de s'écarter (DET-43, DET-47), et annonce les conséquences : fiche d'alerte annulée ou allégée (ALE-22), cas qui sort des calculs et, s'il est écarté après le coup d'envoi, reste compté à part dans le tableau de validation (SUI-17), messages en attente abandonnés (TEL-38). « Réintégrer » un événement écarté (DET-45), avec la même annonce. Corriger ou retirer l'événement depuis sa fiche (IHM-67, IHM-68).

#### Alertes et historique

- **IHM-33** [Lot 2] — **But** : voir les alertes en cours et ce qu'elles sont devenues. **Affiche** trois rubriques : ouvertes, par heure de coup d'envoi ; closes, la plus récente d'abord ; annulées. Filtres : joueur, type, verdict, période, fiches tardives. Chaque ligne donne le numéro, le joueur, le ou les types, le verdict avec son nombre de cas au moment de l'émission, le match et l'état ; pour une fiche close, l'écart du match et la catégorie du cas (SUI-22). **Action** : ouvrir une fiche.
- **IHM-34** [Lot 2] — La fiche d'alerte, dont le contenu est défini par le document 09, se lit de haut en bas sur téléphone, sans rien déplier pour voir le verdict, le nombre de cas, le match attendu et les réserves. **Actions** : ouvrir les sources, le détail du profil, la fiche de type ; écarter un événement (IHM-32).

#### Tableau de validation

- **IHM-35** [Lot 2] — **But** : confronter honnêtement les profils aux cas suivis (D-35). Le contenu et les règles relèvent du document 10. Présentation : lisible sur téléphone sans défilement horizontal, chaque ligne du tableau devenant un bloc dépliable ; chaque chiffre accompagné de son nombre de cas ; les cas enregistrés après le coup d'envoi, les pronostics tardifs et les cas touchés par une décision prise après le coup d'envoi présentés à part (SUI-25), comme les fiches tardives qui leur correspondent ; en tête, le compteur global des événements retirés (DSN-29, SUI-30) ; date du dernier changement d'un paramètre de calcul (IHM-51) ; aucune recommandation d'arrêt ni conclusion automatique. **Actions** : filtrer par joueur et par type ; ouvrir un profil ou une fiche d'alerte.

#### Sources de presse

- **IHM-36** [Lot 2] — **But** : vérifier que la collecte fonctionne. **Affiche** chaque source (document 03) : nom, langue, état de santé (jamais lue, fonctionnelle, en panne ou muette depuis…, COL-40), état d'activation, dernière lecture réussie, indicateurs de COL-11, trous de collecte possibles (COL-46). **Actions**, selon le document 03 : ajouter une source après l'essai de son flux et l'attestation « presse sportive publique » (COL-03, variante A du document 03), modifier, désactiver, réactiver, retirer, lancer une collecte à la demande (COL-14).
- **IHM-71** [Lot 2] — **Collecte et détection. But** : comprendre ce que la veille quotidienne a lu et retenu. L'entrée « Collecte et détection » réunit : les sources de presse (IHM-36) ; le journal de collecte (COL-48, COL-49) ; la file d'attente de classification, dans son ordre de priorité (DET-09), où l'utilisateur peut classer lui-même un article ou demander une nouvelle classification (DET-13, DET-50) ; les articles non pertinents encore conservés, avec leur motif et la réponse du modèle, que l'utilisateur peut repêcher (DET-24, DET-49) ; le journal de détection et ses indicateurs de qualité (DET-55, DET-56) ; les instructions données au modèle, en lecture seule (DET-23). Chaque article mène à l'événement qui le cite.

#### Réglages et paramètres

- **IHM-37** [Lot 1] — **But** : régler l'application. Rubriques :
  - **Compte** : mot de passe et déconnexion (IHM-08, IHM-09) ;
  - **Affichage** : fuseau horaire (IHM-14), adresse de l'outil de recherche (IHM-44) ;
  - **Paramètres** : chaque paramètre, défini par son document et recensé par le document 14, est présenté avec les informations que fixe TRV-34, une phrase d'explication en clair et « Rétablir la valeur par défaut » ; une modification qui change des verdicts n'est enregistrée qu'après une confirmation qui annonce sa conséquence (« tous les profils seront recalculés ») ;
  - **Notifications**, au lot 2 : liaison Telegram et réglages du document 11 ;
  - **Aide** : installer l'application, glossaire, relancer le guide de démarrage, version.

#### Journal d'activité

- **IHM-38** [Lot 1] — **But** : savoir ce que l'application a fait. **Affiche** la liste chronologique définie par le document 14 : passages des tâches planifiées, imports, recalculs, changements de paramètres avec l'ancienne et la nouvelle valeur, incidents, connexions refusées, et au lot 2 envois et échecs de notifications. Filtres par catégorie et par période ; chaque entrée mène à l'objet concerné.

#### État de l'application et méthode

- **IHM-70** [Lot 1] — **État de l'application. But** : voir d'un coup d'œil si tout fonctionne. **Affiche** le contenu fixé par TRV-46, le rappel d'export (TRV-54) et l'avancement des récupérations de statistiques (STA-41). **Actions** : lancer une tâche à la main (TRV-33) ; lancer la vérification de l'installation et lire son résultat service par service (TRV-47) ; forcer la récupération d'un match, d'une saison ou de l'historique d'un joueur (STA-44) ; télécharger un export (TRV-52).
- **IHM-69** [Lot 1] — **Page « Méthode et limites »** (VUE-09). Accessible depuis « Plus », depuis l'aide et depuis la mention courte des écrans de profil et de validation (IHM-50), elle présente le contenu que fixe le document 00 (hypothèse conditionnelle, limites connues, points de vigilance) et le compteur global des événements retirés (DSN-29), et donne accès aux pièges d'interprétation du document 08. Elle se lit sur téléphone, sans connaissance statistique.

### Copier, lancer ailleurs, coller : le parcours sur téléphone

- **IHM-39** [Lot 1] — **Copie en un toucher** : « Copier le prompt » place le texte complet dans le presse-papiers, sans sélection manuelle, et confirme (« Prompt copié »). L'heure de la copie est notée sur la demande ; c'est une indication, pas un changement d'état : la demande reste « à faire ».
- **IHM-40** [Lot 1] — **Demande en cours** : une demande dont le prompt a été copié et qui n'est ni importée ni annulée est « en cours ». Tant qu'il en existe une, l'accueil affiche en tête le bandeau « Backtest en cours : le joueur A — prompt copié il y a 12 min — Coller le résultat » ; s'il y en a plusieurs, le bandeau montre la plus récente et le nombre des autres. Cette indication est gardée par l'application, pas seulement par l'appareil : elle se retrouve depuis un autre appareil ou un autre navigateur. Le bandeau peut être masqué (« Plus tard »).
- **IHM-41** [Lot 1] — **Retour au même endroit** : à la réouverture, même si le téléphone a fermé l'application en arrière-plan, l'utilisateur retrouve le dernier écran affiché, à la même position.
- **IHM-42** [Lot 1] — **Brouillon** : tout texte collé ou saisi dans l'écran d'import est gardé aussitôt sur l'appareil puis, dès que la connexion le permet, rattaché à la demande dans l'application, pour être retrouvé depuis un autre appareil (H-IHM-08). C'est la seule copie du texte collé, dans les limites de DSN-32 et d'IMP-03 : elle n'entre ni dans les données enregistrées, ni dans la trace de l'import, ni dans le journal, ni dans les sauvegardes. Le brouillon disparaît à l'enregistrement de l'import, à l'abandon, ou après une durée (paramétrable, 7 jours, H-IHM-03). Ni une expiration de session, ni une mise à jour de l'application, ni une coupure de réseau ne le détruisent.
- **IHM-43** [Lot 1] — **Correction avec l'IA** : « Copier le message de correction » copie, en un toucher, le message que compose le document 06 pour l'IA (IMP-21). L'utilisateur le colle dans sa conversation avec l'IA, puis recommence l'import.
- **IHM-44** [Lot 1] — **Outil de recherche** : un réglage facultatif garde l'adresse de l'outil de recherche approfondie choisi par l'utilisateur ; le bouton « Ouvrir l'outil de recherche » y mène (H-IHM-04). Aucun outil n'est imposé ni nommé (Q-02).

### Affichage honnête des chiffres

- **IHM-45** [Lot 1] — **Toujours le nombre de cas** : tout écart normalisé moyen, partout (profil, tendance générale, liste, fiche, tableau), est accompagné du nombre de cas valides sur lequel il repose et de sa fourchette plausible (SEN-38). Un verdict n'apparaît jamais sans sa confiance du profil et son nombre de cas.
- **IHM-46** [Lot 1] — **Historiques et suivis distingués** : chaque cas porte en toutes lettres « historique » ou « suivi » ; les résumés donnent la répartition (« 7 cas valides : 5 historiques, 2 suivis ») ; les listes de cas se filtrent par origine. Au lot 1, tous les cas sont historiques, et les écrans le disent.
- **IHM-47** [Lot 1] — **Deux sens, même traitement** (H-04) : une sensibilité positive et une sensibilité négative ont la même taille, la même place et le même style ; le sens est écrit (« hausse », « baisse ») en plus du signe ; aucune couleur ne présente la hausse comme une bonne nouvelle ni la baisse comme une mauvaise.
- **IHM-48** [Lot 1] — **Rien de caché** : les cas exclus et non mesurables sont comptés dans les résumés et listés avec leur motif ; un profil sous le seuil le dit avec le libellé de SEN-31 (« non concluant pour ce joueur (2 cas valides sur 5 nécessaires) ») et montre la tendance générale du type sous le titre de SEN-31 ; un calcul incomplet (statistiques en attente, recalcul en cours) est signalé comme tel, avec les dernières valeurs complètes datées, sans verdict provisoire présenté comme définitif.
- **IHM-49** [Lot 1] — **Pas de vitrine** : aucun écran ne montre seulement les profils favorables ; tout tri ou filtre de profils affiche le filtre actif et le total (« 3 profils “probable” sur 41 »).
- **IHM-50** [Lot 1] — **Vocabulaire** : les verdicts s'écrivent exactement « probable », « possible », « non concluant » (D-16) et ne sont jamais qualifiés de « prouvés », « confirmés » ou « garantis » ; « confirmé » et « démenti » ne s'emploient qu'au sens du tableau de validation (D-35, SUI-22, SUI-27). Aucun terme de pari (cote, mise) n'apparaît (D-08) ; le mot « pronostic » ne figure que dans les termes du document 10 (pronostic figé, pronostic tardif, sans pronostic), sur les écrans de validation et dans l'issue d'une fiche, jamais pour annoncer un match à venir. Les écrans de profil et de validation portent la mention courte « Mesure du passé, hypothèse non démontrée, aucune recommandation de pari », avec un lien vers la page « Méthode et limites » (IHM-69) ; la fiche d'alerte porte sa propre mention (document 09).
- **IHM-51** [Lot 1] — **Changements de paramètres visibles** : la date du dernier changement d'un paramètre qui influe sur les verdicts apparaît sur le détail des profils et, au lot 2, sur le tableau de validation, avec un lien vers l'entrée du journal (ancienne et nouvelle valeur).
- **IHM-52** [Lot 1] — **Calcul vérifiable** : depuis tout écart normalisé, l'utilisateur remonte jusqu'aux nombres qui le composent et aux sources de l'événement (D-05).

### États vides et premier parcours guidé

- **IHM-53** [Lot 1] — **Premier lancement** : l'accueil présente Egoscope en deux phrases (ce qu'il mesure ; ce qu'il ne fait pas : prédire un match ou conseiller un pari) et un guide de démarrage dont les étapes se cochent d'elles-mêmes : installer l'application sur le téléphone (facultatif) ; valider au moins un type d'événement ; ajouter au moins un joueur suivi ; demander un backtest et copier le prompt ; coller et enregistrer le résultat ; consulter le premier profil. Au lot 2 s'ajoutent : relier Telegram ; vérifier les sources de presse. Chaque étape mène à l'écran concerné ; le guide se masque et se relance depuis l'Aide.
- **IHM-54** [Lot 1] — **Aucun joueur** : l'écran Joueurs l'explique, rappelle les critères de choix (document 01) et propose « Ajouter un joueur ».
- **IHM-55** [Lot 1] — **Aucun type validé** : l'écran Types l'explique, rappelle qu'aucun backtest ne peut être demandé sans type validé (document 05) et met en avant les types proposés à examiner. « Demander un backtest » est alors inactif et dit pourquoi.
- **IHM-56** [Lot 1] — **Autres états vides** : joueur sans backtest (« pas encore de backtest », avec « Demander un backtest ») ; type sans aucun cas (« aucun événement de ce type trouvé par le backtest du … ») ; « Rien à faire pour le moment » ; au lot 2, aucune alerte (« une alerte naît quand un joueur profilé vit un nouvel événement »), tableau de validation sans cas suivi mesuré, aucune source de presse (« la détection ne peut pas fonctionner »). Un état vide dit toujours pourquoi il est vide et quelle action le remplit.

### Hors connexion

- **IHM-57** [Lot 1] — **Consultation** : l'application garde sur l'appareil la dernière version des écrans principaux (accueil, joueurs, fiches joueurs, profils et leurs cas, demandes « à faire » avec le texte de leur prompt, et au lot 2 fiches d'alerte ouvertes), rafraîchie à chaque connexion. Hors connexion, ces écrans restent consultables sous un bandeau « Hors connexion — données du … à … », et le prompt d'une demande peut être copié.
- **IHM-58** [Lot 1] — **Saisie** : hors connexion, les actions qui exigent le serveur (enregistrer un import, écarter un événement, valider un type, modifier un paramètre) sont inactives et disent pourquoi ; ce qui a été saisi est conservé en brouillon (IHM-42) et l'application propose de le reprendre au retour du réseau. Aucune action n'est envoyée plus tard à l'insu de l'utilisateur (H-IHM-07).
- **IHM-59** [Lot 1] — Les données gardées sur l'appareil se limitent à ce qui est affiché et aux brouillons d'IHM-42, et sont effacées à la déconnexion (DSN-33) ; après un retrait, l'événement disparaît des copies de l'appareil à son prochain rafraîchissement.

### Accessibilité et lisibilité

- **IHM-60** [Lot 1] — Le texte suit la taille de caractères réglée sur le téléphone, sans perte de contenu ; les chiffres ne sont jamais tronqués et les libellés passent à la ligne.
- **IHM-61** [Lot 1] — Contrastes et tailles des zones tactiles respectent le niveau AA des règles internationales d'accessibilité des contenus web (WCAG). Aucune information n'est portée par la seule couleur : verdict, sens, origine des cas et états sont toujours écrits.
- **IHM-62** [Lot 1] — Chaque bouton a un libellé explicite, restitué par les lecteurs d'écran ; les chiffres y sont lus avec leur signe.
- **IHM-63** [Lot 1] — Les longs textes (prompt, résultat collé, aperçu) s'affichent dans des zones lisibles, avec retour à la ligne ; l'application fonctionne en portrait comme en paysage et suit le thème clair ou sombre du téléphone.

### Répartition par lot

- **IHM-64** [Lot 1] — Au lot 1 : installation, accès, langue et formats, navigation, accueil et « à faire » (demandes manuelles et complémentaires, compléments proposés, incidents du lot 1, joueurs, types proposés, événements à requalifier ou à répartir, cas signalés), ajout d'un joueur, joueurs suivis, fiche joueur, détail des profils et des cas, fiche et retrait d'un événement, demandes de backtest, import, taxonomie et exploration de types, réglages hors notifications, état de l'application, journal d'activité, page « Méthode et limites », affichage honnête, états vides et guide, hors connexion, accessibilité.
- **IHM-65** [Lot 2] — Au lot 2 : demandes nées de la détection, incidents de collecte et de détection et événements « datation à vérifier » dans « à faire », entrée « Alertes », fiches d'alerte et alertes ouvertes sur l'accueil, événements détectés et actions « Écarter » et « Réintégrer », tableau de validation, collecte et détection (sources de presse, file d'attente, articles non pertinents, journaux), réglages des notifications et liaison Telegram, liens venus de Telegram, cas suivis dans les profils.

## Données manipulées

- **Session** : appareil, date d'ouverture, date de dernière utilisation, date d'expiration.
- **Échecs de connexion** : date et heure, et blocage en cours avec son terme (TRV-61).
- **Réglages d'interface** : fuseau horaire, adresse de l'outil de recherche, état du guide de démarrage, incidents masqués, bandeau « demande en cours » masqué.
- **Indication « prompt copié »** d'une demande : date et heure, gardée par l'application.
- **Brouillon d'import** : texte collé, demande associée, date de dernière modification, appareil d'origine ; jamais sauvegardé ni journalisé (DSN-32).
- **Données gardées sur l'appareil** : copie des écrans principaux avec leur date de chargement, dernier écran affiché et position dans les listes.

L'interface ne crée aucune donnée métier : elle affiche celles des autres documents et leur transmet les actions de l'utilisateur.

## Cas limites et erreurs

- **Texte collé tronqué ou entouré de texte libre** : l'aperçu le signale selon le document 06 ; l'écran suggère de recopier la réponse complète ou d'utiliser « Copier le message de correction ».
- **Résultat collé dans la demande d'un autre joueur** : l'aperçu met en regard le joueur de la demande et celui du résultat ; le contrôle relève du document 06.
- **Demande déjà importée depuis un autre appareil** alors qu'un brouillon existe ici : le brouillon est marqué « demande déjà importée » et peut être abandonné.
- **Presse-papiers inaccessible** : la copie sélectionne tout le texte et invite à l'appui long ; le collage s'explique de même.
- **Résultat très long** : l'aperçu se charge par tranches ; une éventuelle limite de taille relève du document 06.
- **Lien Telegram ouvert dans le navigateur** plutôt que dans l'application installée, qui selon le téléphone ne partagent pas toujours la session : connexion, puis écran visé ; la demande en cours et les brouillons rattachés à la demande restent retrouvables (IHM-40, IHM-42).
- **Lien vers un objet disparu** (événement retiré, demande annulée) : l'écran explique ce qu'il est devenu.
- **Nouvelle version pendant une saisie** : le rechargement attend que le brouillon soit gardé.
- **Objet modifié ailleurs** (autre appareil, tâche planifiée) pendant que l'utilisateur agit dessus : l'application le signale et montre la version à jour avant d'enregistrer.
- **Recalcul en cours ou statistiques indisponibles** : les profils montrent les dernières valeurs complètes datées, avec « recalcul en cours » ou « en attente de statistiques ».
- **Erreur du serveur** : message en français, sans jargon, qui dit ce que l'utilisateur peut faire ; la saisie est conservée.
- **Écran étroit ou très grande taille de caractères** : la mise en page s'adapte sans masquer de chiffre.

## Critères d'acceptation

1. (IHM-02) Étant donné le téléphone de l'utilisateur, quand il installe l'application depuis son navigateur, alors une icône « Egoscope » apparaît et l'application s'ouvre en plein écran sur l'accueil.
2. (IHM-05, IHM-11) Étant donné un appareil non connecté, quand on ouvre l'adresse d'un écran, y compris par un lien reçu sur Telegram, alors seul l'écran de connexion s'affiche, puis l'écran visé une fois la connexion faite.
3. (IHM-07) Étant donné une connexion bloquée après des échecs répétés (TRV-61), quand une nouvelle tentative a lieu pendant le blocage, alors l'écran indique que la connexion est bloquée et jusqu'à quand, le mot de passe n'est pas examiné, même s'il est exact, et la tentative figure au journal d'activité.
4. (IHM-20) Étant donné, au lot 2, trois demandes « à faire » : une demande manuelle, la plus ancienne, et deux demandes nées d'une détection dont les matchs attendus commencent dans 30 h et dans 6 h, quand l'utilisateur ouvre l'accueil, alors elles apparaissent dans l'ordre 6 h, 30 h, puis la demande manuelle (BKT-18), et la première porte la mention « échéance proche ».
5. (IHM-39, IHM-40) Étant donné une demande « à faire », quand l'utilisateur touche « Copier le prompt », alors le texte complet est dans le presse-papiers, une confirmation s'affiche, et l'accueil montre le bandeau « Backtest en cours » pour ce joueur, y compris sur un autre appareil connecté.
6. (IHM-41, IHM-42) Étant donné un résultat collé mais pas encore enregistré, quand le téléphone ferme l'application en arrière-plan puis que l'utilisateur la rouvre, alors l'écran d'import réapparaît avec le texte collé intact ; une fois l'import enregistré, le texte collé n'est plus conservé nulle part (DSN-32).
7. (IHM-11, IHM-42) Étant donné une session expirée pendant que l'utilisateur était dans son application d'IA, quand il revient et se reconnecte, alors il retrouve l'écran d'import et son brouillon.
8. (IHM-29, IHM-43) Étant donné un résultat qui contient une erreur bloquante, quand l'utilisateur touche « Vérifier », alors l'erreur est décrite en français avec l'événement concerné, « Enregistrer » est inactif et « Copier le message de correction » produit un texte prêt à coller dans l'IA.
9. (IHM-45, IHM-46) Étant donné un profil de 7 cas valides dont 2 suivis, quand il s'affiche dans la fiche joueur ou dans le détail du profil, alors son écart moyen est accompagné de « 7 cas valides » et de la répartition « 5 historiques, 2 suivis ».
10. (IHM-47) Étant donné deux profils d'écarts +0,60 et −0,60 avec le même nombre de cas, quand ils s'affichent dans la fiche joueur, alors ils ont la même présentation, et les mots « hausse » et « baisse » accompagnent les signes.
11. (IHM-24, IHM-48) Étant donné un profil qui comporte 2 cas exclus, quand l'utilisateur ouvre son détail, alors ces 2 cas figurent dans le groupe « cas exclus » avec leur motif, et le résumé les compte.
12. (IHM-49) Étant donné un filtre « verdict probable » actif, quand la liste des profils s'affiche, alors le filtre et le nombre total de profils sont indiqués.
13. (IHM-53, IHM-55) Étant donné une application vide, quand l'utilisateur l'ouvre pour la première fois, alors le guide de démarrage s'affiche et « Demander un backtest » est inactif, avec l'explication « aucun type validé ».
14. (IHM-57, IHM-58) Étant donné un téléphone hors connexion, quand l'utilisateur ouvre une demande déjà chargée, alors il peut lire et copier le prompt ; sur l'écran d'import, « Enregistrer » est inactif avec une explication et la saisie est conservée.
15. (IHM-14) Étant donné le fuseau « heure de Paris » et un match qui commence le mardi 17 novembre à 19 h 30, heure de New York, quand ce match s'affiche, alors on lit « mer. 18 nov. à 1 h 30 », avec le rappel « mardi soir aux États-Unis ».
16. (IHM-61) Étant donné un écran affiché sans couleurs, quand l'utilisateur lit un profil, alors le verdict, le sens et l'origine des cas restent lisibles en toutes lettres.
17. (IHM-37, IHM-51) Étant donné la modification d'un seuil qui influe sur les verdicts, quand l'utilisateur la confirme, alors le changement est inscrit au journal avec l'ancienne et la nouvelle valeur, et sa date apparaît sur le détail des profils.
18. (IHM-32) Étant donné un événement détecté rattaché à une fiche d'alerte ouverte, quand l'utilisateur touche « Écarter », alors l'écran rappelle qu'un écartement corrige une erreur de détection et ne dépend jamais du résultat du match, et annonce que la fiche sera annulée ou allégée, avant de demander confirmation.
19. (IHM-06) Étant donné une application qui vient d'être installée, quand l'utilisateur se connecte avec le mot de passe initial, alors seul l'écran de choix du mot de passe s'ouvre, jusqu'à ce qu'il l'ait remplacé.
20. (IHM-23, IHM-48) Étant donné un couple joueur-type de 2 cas valides, quand il s'affiche dans la fiche joueur, alors on lit « non concluant pour ce joueur (2 cas valides sur 5 nécessaires) » et la tendance générale du type sous le titre « tendance générale du type, ne décrit pas ce joueur ».
21. (IHM-25) Étant donné un cas mesuré, quand l'utilisateur veut l'exclure, alors seuls les motifs de la liste fermée de SEN-17 sont proposés, aucun ne portant sur la performance.
22. (IHM-68) Étant donné un événement historique, quand l'utilisateur touche « Retirer », alors l'écran annonce ce qui va disparaître et les limites du retrait, puis demande confirmation ; après confirmation, aucun écran ne mentionne plus l'événement et la page « Méthode et limites » affiche un retrait de plus (IHM-69).
23. (IHM-70) Étant donné l'écran d'état, quand l'utilisateur lance à la main la mise à jour des statistiques, alors l'exécution est marquée « à la demande » au journal et l'exécution planifiée suivante est maintenue (TRV-33).
24. (IHM-20, IHM-66) Étant donné un joueur ajouté alors que la source de statistiques est indisponible, quand la source répond de nouveau, alors ses candidats apparaissent dans la liste « à faire ».

## Dépendances

- [00 — Vue d'ensemble](00-vue-d-ensemble.md) : glossaire repris par l'aide sur les termes, objets métier.
- [01 — Joueurs suivis](01-joueurs-suivis.md) : contenu de la fiche joueur et de la liste (JOU-25 à JOU-28), ajout et correspondance statistique (JOU-10), pause, retrait, suppression des données (JOU-24), critères de choix, rubriques « à faire » (JOU-04, JOU-06, JOU-22).
- [02 — Taxonomie des événements](02-taxonomie-des-evenements.md) : fiches de type, cycle de vie, versions, types candidats de départ, prompt d'exploration et reprise de ses propositions, événements à requalifier ou à répartir (TAX-25, TAX-29).
- [03 — Collecte des actualités](03-collecte-des-actualites.md) : sources, états, essai d'un flux, collecte à la demande, journal de collecte.
- [04 — Détection des événements](04-detection-des-evenements.md) : événements détectés, confiance de détection, motifs d'écartement, réintégration (DET-45), rappel de DET-46, file d'attente, articles non pertinents, journal de détection.
- [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) : déclencheur, nature, états, échéance et rang des demandes (BKT-16 à BKT-18), mise à jour et réduction (BKT-15), texte du prompt copiable d'un seul geste (BKT-20), format du résultat.
- [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) : champ de collage (IMP-02), conservation du texte collé (IMP-03), contrôles, messages d'erreur (IMP-20) et message de correction (IMP-21), aperçu (IMP-22, IMP-23), refus restants, fiche d'un événement historique, corrections et suppressions (IMP-32, IMP-33), historique des imports (IMP-31).
- [07 — Statistiques de match](07-statistiques-de-match.md) : prochain match, référence de saison, candidats d'identité (STA-03), avancement et relance des récupérations (STA-41, STA-44).
- [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) : valeurs affichées, libellés sous le seuil (SEN-31), confiance du profil, avertissements (SEN-46), motifs d'exclusion et de réintégration (SEN-17), signalements (SEN-16), profils archivés (SEN-19), recalcul.
- [09 — Fiche d'alerte](09-fiche-d-alerte.md) : contenu et états de la fiche.
- [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) : contenu du tableau de validation, catégories des cas, comptes à part (SUI-25).
- [11 — Notifications Telegram](11-notifications-telegram.md) : réglages des notifications, liens de retour, liaison.
- [13 — Données sensibles](13-donnees-sensibles.md) : retrait d'un événement et ses limites (DSN-26 à DSN-28), compteur des retraits (DSN-29), stockage minimal.
- [14 — Exigences transverses](14-exigences-transverses.md) : règles de sécurité d'accès (TRV-57 à TRV-63), paramètres (TRV-34), journal, quotas, sauvegarde et export, écran d'état (TRV-46), lancement manuel des tâches (TRV-33), vérification de l'installation (TRV-47).
- [90 — Journal des décisions](90-journal-des-decisions.md).

## Hypothèses et questions ouvertes

Renvois au journal :

- **D-25** : l'application est une application web installable de type PWA ; ce document n'en décrit que le comportement visible.
- **H-10**, **H-11**, **H-12** : appliquées telles quelles.
- **Q-01** : l'aide intégrée, le guide de démarrage et les états vides explicatifs tiennent compte d'un niveau technique inconnu.
- **Q-02** : aucun outil de recherche n'est nommé ; l'utilisateur choisit le sien.

Hypothèses locales :

- **H-IHM-01 — Navigation** (à confirmer) : barre en bas de l'écran avec Accueil, Joueurs, Types et Plus au lot 1, plus Alertes au lot 2 ; les autres écrans sous « Plus ».
- **H-IHM-02 — Fuseau horaire par défaut** (à confirmer) : heure de Paris, l'interface étant en français et les heures de match devant être converties depuis les États-Unis ; l'utilisateur peut le changer.
- **H-IHM-03 — Valeurs par défaut** (à confirmer, toutes paramétrables) : listes par tranches de 50 éléments ; brouillon gardé 7 jours au plus ; « échéance proche » à moins de 24 h. Les valeurs de sécurité relèvent du document 14 (H-TRV-10).
- **H-IHM-04 — Adresse de l'outil de recherche** (à confirmer) : réglage facultatif qui ajoute un bouton d'accès direct à l'outil choisi par l'utilisateur.
- **H-IHM-05** — Supprimée, voir TRV-57 et TRV-63 du [14](14-exigences-transverses.md).
- **H-IHM-06 — Plusieurs appareils** (à confirmer) : le téléphone et un ordinateur peuvent être connectés en même temps au compte unique.
- **H-IHM-07 — Pas d'envoi différé** (à confirmer) : une action tentée hors connexion n'est pas mise en file pour plus tard ; seule la saisie est conservée.
- **H-IHM-08 — Brouillon rattaché à la demande** (à confirmer) : le texte collé est gardé par l'application, et pas seulement par l'appareil, jusqu'à l'enregistrement, l'abandon ou l'expiration du brouillon, dans les limites que le document 13 valide (DSN-32).

Questions locales : aucune.
