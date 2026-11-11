# 13 — Données sensibles

## Objet

Egoscope enregistre des faits qui concernent des personnes réelles, et certains touchent à l'intime : un deuil, des propos racistes subis, une polémique. Ce document fixe ce que l'application a le droit de collecter et de conserver, ce qu'elle ne doit jamais stocker, comment elle formule ce qu'elle garde, comment l'utilisateur efface un événement et ses traces, et ce qu'il faudrait revoir si l'outil cessait d'être strictement personnel. Ses règles s'appliquent à toutes les fonctions et sont formulées pour pouvoir être vérifiées.

## Décisions d'origine

- D-20 — Presse publique uniquement et stockage minimal : type d'événement, date, lien vers la source ; pas de détail intime.
- D-02 — Outil personnel : un seul utilisateur, aucune diffusion ni commercialisation.
- D-10 — Les sources sont la presse sportive et les archives d'actualités, datées et vérifiables.
- D-09 — La recherche approfondie est exécutée par l'utilisateur dans une IA extérieure, à partir d'un prompt produit par l'application.
- D-26 — Les articles sont classés par un modèle de langage à palier gratuit, extérieur à l'application.
- D-19 — Des champs de contexte, dont le retour de blessure, servent à exclure les cas douteux.
- D-27 — La recherche approfondie ne fournit que des événements, jamais de statistiques.
- D-30 — Les notifications passent par Telegram.
- D-35 — Le tableau de validation doit rester honnête.
- H-01 — Comptage exhaustif : retirer des événements fragilise les profils.
- H-08 — Un événement détecté à tort peut être écarté.
- H-09 — Les indications de contexte viennent de la recherche ou de la classification et sont corrigées par l'utilisateur.
- H-10 — Un seul compte protège l'application.
- H-11 — Interface en français ; presse anglophone et francophone.

## Périmètre

Ce document couvre :
- les règles de collecte : quelles sources sont admises ;
- les règles de stockage minimal : ce qu'un événement porte, et rien de plus ;
- les règles propres aux sujets intimes : deuil, racisme, famille, santé, affaires judiciaires ;
- la liste de ce qui ne doit jamais être stocké ;
- la formulation des descriptions ;
- les copies temporaires : texte collé gardé en brouillon, données gardées sur l'appareil ;
- le retrait d'un événement et de ses traces, y compris les articles qui lui sont rattachés ;
- l'usage strictement personnel, la discrétion des notifications, et ce qu'il faudrait revoir en cas de partage.

Il ne couvre pas, et renvoie à :
- le choix des flux, la durée de conservation des articles et leur purge : [03 — Collecte des actualités](03-collecte-des-actualites.md) ;
- la classification des articles et l'état « écarté » d'un événement détecté à tort : [04 — Détection des événements](04-detection-des-evenements.md) ;
- le texte du prompt de recherche et le format du résultat, qui reprennent ces règles : [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) ;
- les contrôles et corrections à l'import : [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) ;
- l'exclusion des cas douteux et le recalcul des profils : [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) ;
- le contenu et l'envoi des messages Telegram : [11 — Notifications Telegram](11-notifications-telegram.md) ;
- les écrans d'accès : [12 — Interface et accès](12-interface-et-acces.md) ; les règles de sécurité et d'authentification : [14 — Exigences transverses](14-exigences-transverses.md) ;
- les sauvegardes et la journalisation : [14 — Exigences transverses](14-exigences-transverses.md) ;
- la suppression de toutes les données d'un joueur : [01 — Joueurs suivis](01-joueurs-suivis.md).

## Principes

1. **Presse publique uniquement.** L'application ne sait d'un joueur que ce que la presse a publié (D-20, D-10).
2. **Stockage minimal.** Elle ne garde que ce qui sert au calcul et à la preuve : le type, la date, le lien vers la source (D-20), et, au-delà de cette liste, une description courte et neutre (H-DSN-09) et les indications nécessaires au calcul (D-19).
3. **Usage strictement personnel.** Rien de ce qu'elle stocke n'est destiné à quelqu'un d'autre que l'utilisateur (D-02).

## Règles de collecte

- **DSN-01** [Lot 1] — Toute source d'un événement est un article de presse ou d'archive d'actualités, publié publiquement et daté (D-10, D-20). Ne sont pas des sources admises : un message privé, une fuite, un document qu'aucun média n'a publié, un forum, une rumeur non publiée par un média.
- **DSN-02** [Lot 2] — La collecte ne récupère que des contenus que leurs éditeurs mettent publiquement à disposition, sans contourner aucune restriction d'accès ; le choix des flux relève de 03.
- **DSN-03** [Lot 1] — Un message publié sur un réseau social, y compris par le joueur lui-même, n'est retenu que s'il est rapporté par un article de presse ; la source enregistrée est alors l'article, jamais le message.
- **DSN-04** [Lot 1] — Le prompt de recherche (05) et le prompt d'exploration ([02 — Taxonomie des événements](02-taxonomie-des-evenements.md)) ne transmettent à l'IA que des données publiques (noms des joueurs, équipes, faits déjà publiés) et des fiches de type. Aucune donnée personnelle sur l'utilisateur n'y figure.
- **DSN-05** [Lot 2] — Les textes transmis au modèle de langage pour la classification (04) sont le titre et l'extrait d'articles publics, accompagnés des fiches de type et des événements récents des joueurs reconnus, déjà conformes à ce document. Aucune donnée personnelle sur l'utilisateur ne les accompagne.

## Règles de stockage minimal

- **DSN-06** [Lot 1] — Un événement ne porte que les données suivantes, et aucune autre :
  - le joueur suivi concerné et le type d'événement, avec sa version de fiche ;
  - la date de référence et sa précision ;
  - une ou plusieurs sources, chacune réduite à son lien, son média, son titre et sa date de publication ; pour un événement détecté, l'indication de celle qui est l'article de référence (04) ;
  - une description courte conforme aux règles DSN-19 à DSN-23 (H-DSN-09) ;
  - les indications de contexte, sous forme d'indicateurs (DSN-07) ;
  - sa confiance de détection (04) ou sa confiance de la recherche (05) ;
  - les marques et contrôles de datation : « datation à vérifier » et « détecté après le coup d'envoi » pour un événement détecté (04) ; antériorité, avertissements d'import et réserve sur ce qui n'a pas pu être vérifié pour un événement historique (06) ;
  - les données de gestion : origine (détecté ou historique), état, dates de création et de modification, résultats de classification et motif d'un écartement (04), trace des corrections (04, 06), mentions de requalification (02).
- **DSN-07** [Lot 1] — Une indication de contexte est un indicateur, jamais un récit. Le retour de blessure s'enregistre par oui, non ou inconnu, sans la nature de la blessure ; l'enjeu du match, sous la forme fermée définie par 05 et au sens défini par 08 (SEN-14), sans commentaire. La précision facultative que le format du résultat admet (05) ne sert qu'à vérifier ces indications dans l'aperçu d'import ; elle n'est pas conservée (05, 06).
- **DSN-08** [Lot 1] — Le lien et le titre d'une source sont conservés tels que publiés, parce qu'ils identifient la source (H-DSN-04). Ce sont les seules données textuelles que ni l'application ni l'IA ne réécrivent ; ils peuvent refléter ce que la presse a publié, ce qui est la limite assumée d'un stockage fondé sur le lien vers la source (D-20). Aucun extrait du corps d'un article n'est conservé avec la source d'un événement ; l'extrait que la collecte garde un temps suit DSN-09.
- **DSN-09** [Lot 2] — L'application ne conserve d'un article que ce que fixe 03 : jamais son texte intégral, seulement un court extrait fourni par le flux. Cet extrait ne sert qu'à la détection : il n'est pas conservé au-delà de la durée fixée par 03, sauf pour un article lié à une proposition de type, dont il est gardé jusqu'à la décision sur cette proposition pour permettre le reclassement (02, 04). Ensuite, seules restent les références (lien, média, titre, date de publication) des articles rattachés à un événement ou à une proposition de type, occurrences comprises (02), et, pour les articles purgés, une trace de dédoublonnage réduite au lien, que le retrait d'un événement ne laisse pas (03, DSN-34).
- **DSN-10** [Lot 1] — Tout champ de texte libre attaché à un événement, à un cas ou à une fiche de type obéit aux règles de formulation de ce document, qu'il soit rempli par une IA ou par l'utilisateur : description, réserve sur ce qui n'a pas pu être vérifié (06), justification d'une classification (04), commentaire d'une décision. Il en va de même des limites déclarées par l'IA et gardées avec un import (06).
- **DSN-11** [Lot 1] — Le journal d'activité et ses détails techniques (14), réponses brutes des services comprises, ne contiennent aucune description d'événement, aucune justification de classification, aucun texte ni titre d'article, ni aucun des éléments de DSN-18.
- **DSN-32** [Lot 1] — **Texte collé et brouillons.** Le texte collé d'un résultat de recherche ou d'un retour d'exploration n'est gardé que comme brouillon, sur l'appareil et dans l'application, le temps de l'import ou de l'aperçu (12, IHM-42, H-IHM-08) : il est effacé à l'enregistrement, à l'abandon ou à l'expiration du brouillon, et ni la trace de l'import, ni le journal, ni les sauvegardes ne le contiennent (H-DSN-11). Du résultat, l'application ne garde ensuite que les événements enregistrés, le nombre de pistes non vérifiées par type et les limites déclarées par l'IA, soumises à DSN-10 ; ces règles valident H-IMP-10 (06).
- **DSN-33** [Lot 1] — **Données gardées sur l'appareil.** Les copies d'écrans gardées sur l'appareil pour la consultation hors connexion (12, IHM-57, IHM-59) ne contiennent que ce que les écrans affichent, donc rien de ce que ce document interdit de stocker ; elles sont effacées à la déconnexion. Après un retrait, l'événement disparaît des copies d'un appareil à son prochain rafraîchissement (DSN-28).

## Sujets intimes

- **DSN-12** [Lot 1] — **Deuil.** Pour la mort d'un proche, la description dit seulement qu'un proche du joueur est décédé et que la nouvelle est devenue publique. Elle ne mentionne ni le nom du défunt, ni son lien de parenté, ni la cause ou les circonstances du décès, ni les obsèques.
- **DSN-13** [Lot 1] — **Racisme.** Pour des propos ou des actes racistes subis, la description dit le fait (le joueur est visé), l'auteur désigné par son rôle et le cadre (pendant un match, en ligne). Elle ne reproduit jamais les termes employés et ne mentionne jamais l'origine, la couleur de peau, la nationalité ou la religion du joueur.
- **DSN-14** [Lot 1] — **Famille et vie privée.** Aucune donnée sur les proches du joueur n'est enregistrée : ni nom, ni âge, ni image, ni situation. Rien n'est enregistré sur sa vie sentimentale, son domicile, ses enfants, sa situation financière, ses opinions ou ses croyances. La seule exception est le fait même du deuil, dans les limites de DSN-12.
- **DSN-15** [Lot 1] — **Santé.** Aucun diagnostic, aucune nature de blessure ou de maladie, aucun traitement, aucune information sur la santé mentale n'est enregistré, même si la presse ou le joueur l'a publié. La blessure n'intervient que comme indicateur de contexte (DSN-07) et comme absence constatée dans les statistiques (01). Aucun type d'événement ne peut avoir pour objet la santé du joueur (H-DSN-05).
- **DSN-16** [Lot 1] — **Affaires judiciaires.** Quand un fait retenu, par exemple dans une tourmente médiatique, tient à une procédure ou à une accusation, la description dit seulement que le joueur est mis en cause publiquement dans une affaire rapportée par la presse ; elle ne mentionne ni les faits reprochés, ni l'identité des autres parties (H-DSN-06).
- **DSN-17** [Lot 1] — **Autres personnes.** Les personnes autres que le joueur suivi sont désignées par leur rôle (un adversaire, un coéquipier, un entraîneur, un dirigeant, un spectateur, un proche), jamais par leur nom, y compris quand ce sont des personnalités publiques (H-DSN-02).

## Ce qui ne doit jamais être stocké

- **DSN-18** [Lot 1] — L'application ne stocke jamais, dans aucun champ ni aucune copie, les éléments suivants ; seuls le lien et le titre d'une source, conservés tels que publiés (DSN-08), peuvent les refléter :
  - le corps d'un article, entier ou en extrait, au-delà de la durée de détection (DSN-09) ;
  - une image, une vidéo ou un son, quelle qu'en soit la source ;
  - le nom, l'image, l'âge ou toute autre donnée d'une personne privée : proche, enfant, spectateur, auteur anonyme, plaignant ;
  - les termes d'une insulte, d'un propos raciste ou d'un message haineux ;
  - l'origine, la couleur de peau, la nationalité, la religion, les opinions, l'orientation sexuelle ou la vie sentimentale du joueur ;
  - un diagnostic, la nature d'une blessure ou d'une maladie, un traitement, un état de santé mentale, la cause d'un décès ;
  - les faits reprochés dans une procédure judiciaire et l'identité des parties ;
  - une adresse, un lieu de résidence ou un déplacement privé ;
  - une interprétation des sentiments ou des intentions du joueur ;
  - un contenu d'origine non publique (DSN-01).

## Formulation des descriptions

- **DSN-19** [Lot 1] — Une description d'événement est une phrase factuelle et neutre qui dit qui, désigné par son rôle, a fait quoi envers le joueur, et quel genre de média l'a rapporté. Exemple conforme : « Un adversaire déclare publiquement que le joueur A est surcoté ; un média national le rapporte la veille du match contre l'équipe X. »
- **DSN-20** [Lot 1] — Une description compte au plus 200 caractères, valeur par défaut paramétrable (paramètre « longueur maximale d'une description », H-DSN-01). Ce document en est le propriétaire : le prompt de recherche (05), la classification (04) et l'import (06) appliquent ce même paramètre au lieu d'en tenir un autre.
- **DSN-21** [Lot 1] — Une description ne contient aucune citation textuelle : les propos sont résumés, jamais reproduits entre guillemets (H-DSN-03).
- **DSN-22** [Lot 1] — Une description ne contient ni jugement de valeur (« honteux », « scandaleux », « magnifique »), ni interprétation psychologique (« il a été blessé dans son orgueil », « il voudra se venger »), ni pronostic sur le match.
- **DSN-23** [Lot 1] — Une description est rédigée en français, même quand la source est anglophone (H-11, H-DSN-08).
- **DSN-24** [Lot 1] — Le prompt de recherche (05) reprend les règles DSN-12 à DSN-23. À l'import (06), l'application vérifie d'elle-même la longueur de chaque description et l'absence de guillemets ; une description qui échoue à l'un de ces contrôles doit être corrigée avant l'enregistrement. Les autres règles ne se vérifient qu'à la lecture : l'aperçu d'import les rappelle à l'utilisateur.
- **DSN-25** [Lot 2] — La classification (04) reprend les mêmes règles pour ses descriptions et ses justifications, et les soumet aux contrôles de DSN-24. Une description ou une justification non conforme n'est jamais enregistrée ni envoyée telle quelle ; la façon de la remplacer relève de 04.

## Retrait d'un événement et de ses traces

- **DSN-26** [Lot 1] — L'utilisateur peut retirer n'importe quel événement, détecté ou historique, à tout moment, depuis son détail, pour une raison de sensibilité. Le retrait est un effacement définitif, distinct de l'écartement d'un événement détecté à tort, qui conserve l'événement (H-08, voir 04, DET-51), de la suppression d'un événement historique pour une erreur (06, IMP-33) et de l'exclusion d'un cas douteux (08). Un événement historique qu'il faut effacer pour une raison de sensibilité se retire ; il ne se supprime pas (06, IMP-33).
- **DSN-27** [Lot 1] — Le retrait efface l'événement, sa description, ses sources, ses indications de contexte, son cas et l'historique de ses corrections, ainsi que toute mention de l'événement dans la trace de l'import qui l'a apporté, décomptes compris (06, IMP-37). Au lot 2, il efface aussi : ses résultats de classification et les articles qui lui sont rattachés, selon DSN-34 (04, 03) ; dans la fiche d'alerte qui le contient, tout ce qui le concerne, et la fiche entière avec son entrée dans l'historique des alertes s'il en était le seul événement ([09 — Fiche d'alerte](09-fiche-d-alerte.md)) ; son cas suivi, que le tableau de validation ne compte plus ([10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md)) ; le texte, conservé par l'application, des messages Telegram qui le mentionnent, dont elle tente aussi la suppression dans la conversation (11, TEL-38, H-TEL-04). Les profils, les tendances générales et le tableau de validation sont recalculés sans lui (08, 10).
- **DSN-34** [Lot 2] — **Articles d'un événement retiré.** Un article rattaché à un événement retiré, et à aucun autre, est effacé sans attendre la purge de 03 (COL-29, COL-37) : son titre, son lien, son extrait et ses résultats de classification disparaissent, sans trace de dédoublonnage, puisque son lien suffirait à désigner l'événement retiré (03, COL-34 ; H-DSN-10). Un article encore rattaché à un autre événement, par exemple celui d'un second joueur suivi touché par le même fait, est conservé pour cet événement. C'est le seul cas où ce document exige l'effacement immédiat d'un article.
- **DSN-28** [Lot 1] — Avant d'effacer, l'application affiche ce qui va disparaître, rappelle que le retrait répond à une raison de sensibilité et ne dépend jamais du match qui a suivi (H-01), indique les limites du retrait et demande une confirmation. Ces limites sont : un message Telegram que l'application ne parvient plus à supprimer reste dans la conversation de l'utilisateur, qui peut le supprimer lui-même (11, H-TEL-04) ; les sauvegardes conservent l'événement jusqu'à leur renouvellement, selon la durée fixée par 14 ; un export déjà téléchargé le conserve aussi, et il revient à l'utilisateur de supprimer lui-même ses exports antérieurs (14, TRV-56) ; un appareil resté hors connexion le montre jusqu'à son prochain rafraîchissement (DSN-33) ; au lot 2, un article encore proposé par un flux peut être collecté de nouveau et faire renaître l'événement, qu'il faudra alors retirer de nouveau (03, DSN-34) ; un backtest ultérieur peut rapporter de nouveau l'événement, que l'utilisateur pourra ne pas enregistrer dès l'aperçu d'import, pour le motif « donnée sensible », ou retirer de nouveau (06, IMP-37 ; Q-DSN-01).
- **DSN-29** [Lot 1] — L'application tient un compteur global des événements retirés depuis la mise en service, sans joueur, sans type et sans date (H-DSN-07). Il augmente aussi quand l'utilisateur, dans l'aperçu d'un import, n'enregistre pas un événement pour le motif « donnée sensible » (06, IMP-37). C'est la seule trace qu'un retrait laisse : aucun profil, aucune tendance, aucune trace d'import ni aucun journal ne garde ce qui désignerait l'événement retiré (joueur, type, date, source), même sous une forme réduite. Le compteur est affiché sur la page « Méthode et limites » ([00 — Vue d'ensemble](00-vue-d-ensemble.md), VUE-09) et, au lot 2, dans le tableau de validation (10), pour que des retraits ne puissent pas embellir les résultats sans laisser de trace.

## Usage strictement personnel

- **DSN-30** [Lot 1] — L'application n'offre aucune fonction de partage ou de publication : ni lien public, ni export destiné à un tiers, ni second compte (D-02, H-10). La sauvegarde et l'export complet (14) sont destinés au seul utilisateur. Seul le journal d'activité, qui ne contient aucune donnée sensible (DSN-11), peut être exporté pour être montré à la personne qui aide l'utilisateur à diagnostiquer un problème (14, TRV-49).
- **DSN-31** [Lot 2] — Les notifications ne sont envoyées qu'à la conversation privée de l'utilisateur sur Telegram, jamais à un groupe ni à un canal. Elles ne contiennent que des données déjà stockées selon ce document, et jamais d'extrait d'article (11).
- **DSN-35** [Lot 2] — Un message Telegram ne nomme jamais un type dont la fiche porte la mention « sujet intime » (02, TAX-01) : il désigne l'événement comme « événement sensible », et le type ne se lit que dans l'application (H-DSN-12). Telegram est un service tiers, et un message peut s'afficher sur l'écran verrouillé du téléphone. Les autres règles de contenu des messages relèvent de 11 (TEL-06).

## Ce qu'il faudrait revoir si l'outil était partagé

L'usage strictement personnel (D-02) est ce qui rend ces règles suffisantes. Si l'outil était un jour ouvert à d'autres personnes, publié ou commercialisé, les points suivants seraient à reprendre avant toute ouverture ; aucun n'est traité dans la première version.

- **Protection des données personnelles** : hors usage personnel, le règlement général sur la protection des données (RGPD) s'appliquerait pleinement : base légale du traitement, information des joueurs concernés, durées de conservation, droits d'accès, de rectification et d'opposition. Les données sur le deuil, la santé ou des propos racistes relèvent des catégories particulières de données (santé, origine) ou s'en approchent, et leur traitement est très encadré.
- **Profilage de personnes réelles** : un profil de sensibilité attribue à une personne identifiable une fragilité supposée. Diffusé, il pourrait nuire à sa réputation ; il faudrait une analyse d'impact et, sans doute, renoncer à nommer les joueurs.
- **Diffamation** : les descriptions et les verdicts, même neutres, deviendraient des affirmations publiques sur des personnes.
- **Droits sur les contenus de presse** : conserver ou rediffuser des titres et des liens d'articles pour un public pose des questions de droit d'auteur et de droits voisins des éditeurs de presse.
- **Conditions des services gratuits** : les paliers gratuits de la source de statistiques, du modèle de langage ou de l'hébergement peuvent interdire la redistribution des données ou l'usage par plusieurs personnes ; il faudrait les relire (Q-02).
- **Sécurité et accès** : le compte unique (H-10) ne suffirait plus ; il faudrait gérer plusieurs comptes, des droits d'accès et un journal des consultations.
- **Notifications** : un envoi vers un groupe ou un canal Telegram diffuserait les données à des tiers.
- **Pari** : si une fonction de pari était ajoutée (Q-05), la réglementation des jeux d'argent s'ajouterait aux points précédents.

## Cas limites

- **Titre d'article qui contient un détail intime** : il est conservé tel que publié (DSN-08) ; la description, elle, n'en reprend rien.
- **Description produite par l'IA qui nomme le défunt** : l'aperçu d'import la montre ; l'utilisateur la corrige avant d'enregistrer (DSN-12, DSN-24).
- **Le joueur révèle lui-même un problème de santé** : rien n'est enregistré à ce sujet, même si la presse le relaie (DSN-15).
- **Racisme subi en ligne, rapporté par la presse** : l'événement est admis ; la source est l'article, pas le message (DSN-03).
- **Personnalité publique à l'origine d'une humiliation** : elle est désignée par son rôle (DSN-17) ; le détail se lit dans la source.
- **Lien devenu mort** : il reste tel quel ; l'application ne garde aucune copie de l'article pour le remplacer.
- **Retrait d'un événement qui a produit une alerte déjà envoyée** : ce qui le concerne est effacé de la fiche d'alerte, et la fiche entière s'il en était le seul événement ; l'application tente de supprimer le message Telegram, qui reste chez l'utilisateur si Telegram ne le permet plus (DSN-27, DSN-28).
- **Conflit entre deux joueurs suivis, puis retrait de l'événement de l'un d'eux** : l'article commun reste rattaché à l'événement de l'autre joueur et n'est pas effacé (DSN-34).
- **Restauration d'une sauvegarde après un retrait** : l'événement retiré peut revenir ; l'utilisateur doit le retirer de nouveau (Q-DSN-01).
- **Événement historique à effacer pour une raison de sensibilité** : il se retire, il ne se supprime pas (06, IMP-33) ; la trace de l'import n'en garde rien, décomptes compris, et seul le compteur augmente (DSN-27, DSN-29).
- **Nom du joueur dans un message Telegram** : il est admis, puisque la notification ne part que vers la conversation privée de l'utilisateur (DSN-31) ; le type, lui, n'est pas nommé s'il porte la mention « sujet intime » (DSN-35).
- **IA qui recopie un propos injurieux dans le texte collé** : le brouillon le contient le temps de l'import, puis il est effacé (DSN-32) ; l'aperçu montre la description fautive, que l'utilisateur corrige avant l'enregistrement (DSN-24).

## Critères d'acceptation

1. (DSN-01, DSN-03) Étant donné un résultat de recherche dont un événement n'a pour source qu'un message de réseau social, quand l'utilisateur le colle, alors cet événement n'est pas enregistré avec cette source.
2. (DSN-06) Étant donné un événement enregistré, quand on examine toutes ses données, alors on n'y trouve que les éléments énumérés par DSN-06.
3. (DSN-07) Étant donné un événement avec retour de blessure, quand l'utilisateur ouvre son détail, alors il lit que le retour de blessure vaut oui, sans aucune indication sur la nature de la blessure.
4. (DSN-12) Étant donné un événement de type mort d'un proche, quand l'utilisateur lit sa description, alors elle ne mentionne ni nom, ni lien de parenté, ni cause du décès.
5. (DSN-13) Étant donné un événement de type racisme subi, quand l'utilisateur lit sa description, alors aucun des termes employés par l'auteur n'y figure.
6. (DSN-17) Étant donné un conflit entre le joueur A et un joueur de l'équipe X, quand l'utilisateur lit la description de l'événement, alors l'autre joueur y est désigné par son rôle et non par son nom.
7. (DSN-20, DSN-24) Étant donné un résultat de recherche contenant une description de 250 caractères, quand l'utilisateur veut l'enregistrer, alors l'application l'en empêche tant que la description dépasse 200 caractères.
8. (DSN-21, DSN-24) Étant donné une description qui contient une citation entre guillemets, quand l'utilisateur veut l'enregistrer, alors l'application la signale et exige une correction.
9. (DSN-26, DSN-27) Étant donné un événement historique compté dans un profil, quand l'utilisateur le retire et confirme, alors l'événement, ses sources et son cas disparaissent, et le profil est recalculé sans lui.
10. (DSN-27) Étant donné, au lot 2, un événement qui est le seul d'une fiche d'alerte, quand l'utilisateur le retire, alors la fiche d'alerte et son entrée dans l'historique des alertes disparaissent ; étant donné une fiche qui porte aussi un autre événement, alors seul ce qui concerne l'événement retiré en disparaît.
11. (DSN-28) Étant donné une demande de retrait, quand l'application demande confirmation, alors son message rappelle que le retrait ne dépend jamais du match qui a suivi et mentionne les messages Telegram qui ne pourraient plus être supprimés, les sauvegardes, les appareils hors connexion et le risque de nouvelle collecte ou de réimport.
12. (DSN-29) Étant donné deux événements retirés depuis la mise en service, quand l'utilisateur ouvre la page « Méthode et limites », alors il y lit que deux événements ont été retirés, sans indication de joueur, de type ni de date.
13. (DSN-11) Étant donné le retrait d'un événement de type mort d'un proche, quand on consulte le journal d'activité et ses détails techniques, alors on n'y trouve ni sa description ni le titre de sa source.
14. (DSN-30) Étant donné l'application, quand l'utilisateur en parcourt toutes les fonctions, alors aucune ne crée de lien public, d'export destiné à un tiers ni de second compte.
15. (DSN-31) Étant donné une notification à envoyer, quand elle part, alors elle n'est adressée qu'à la conversation privée de l'utilisateur et ne contient aucun extrait d'article.
16. (DSN-27, DSN-29) Étant donné un événement historique apporté par un import, quand l'utilisateur le retire, alors le compteur des événements retirés augmente d'un, et ni la trace de l'import, décomptes compris, ni le profil du joueur ne gardent rien qui le désigne.
17. (DSN-32) Étant donné un résultat de recherche collé puis enregistré, quand on examine la trace de l'import, le journal et la sauvegarde suivante, alors le texte collé n'y figure pas, et des pistes non vérifiées seul leur nombre par type est gardé.
18. (DSN-34) Étant donné, au lot 2, un événement détecté rattaché à deux articles dont l'un l'est aussi à l'événement d'un autre joueur, quand l'utilisateur retire le premier événement, alors l'article qui ne servait qu'à lui est effacé aussitôt, sans trace de dédoublonnage, et l'article commun est conservé.
19. (DSN-35) Étant donné une fiche d'alerte pour un événement d'un type marqué « sujet intime », quand le message Telegram part, alors il désigne l'événement comme « événement sensible » sans nommer le type, et le type se lit dans l'application.

## Dépendances

- [01 — Joueurs suivis](01-joueurs-suivis.md) : limite l'identité d'un joueur ; applique le retrait à chacun de ses événements lors de la suppression de ses données.
- [02 — Taxonomie des événements](02-taxonomie-des-evenements.md) : interdit les types qui portent sur la vie privée ou la santé ; ses fiches et ses exemples suivent les règles de formulation ; la mention « sujet intime » d'une fiche commande DSN-35 ; le retour d'exploration collé suit DSN-32.
- [03 — Collecte des actualités](03-collecte-des-actualites.md) : flux publics ; contenu conservé d'un article, durée de conservation et purge ; effacement immédiat, sans trace de dédoublonnage, des articles d'un événement retiré (DSN-34).
- [04 — Détection des événements](04-detection-des-evenements.md) : classification limitée aux textes publics ; descriptions et justifications conformes ; écartement, distinct du retrait ; effacement des résultats de classification d'un événement retiré.
- [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) : prompt qui reprend les règles de formulation ; forme fermée des indications de contexte ; longueur des descriptions selon DSN-20.
- [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) : contrôles automatiques à l'import ; aperçu qui rappelle les règles ; texte collé non conservé au-delà du brouillon (DSN-32) ; un événement à effacer pour une raison de sensibilité se retire au lieu d'être supprimé, et l'aperçu permet de ne pas enregistrer un événement pour « donnée sensible » (IMP-33, IMP-37) ; effacement des mentions d'un événement retiré dans la trace de l'import.
- [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) : recalcul après un retrait ; aucun décompte de l'événement retiré dans les profils.
- [09 — Fiche d'alerte](09-fiche-d-alerte.md) et [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) : effacement du contenu des fiches d'alerte et des cas suivis retirés ; affichage du compteur dans le tableau de validation.
- [11 — Notifications Telegram](11-notifications-telegram.md) : notifications limitées aux données stockées, vers la seule conversation privée ; tentative de suppression des messages d'un événement retiré ; types marqués « sujet intime » jamais nommés (DSN-35, en réponse à Q-TEL-01).
- [12 — Interface et accès](12-interface-et-acces.md) : compte unique ; page « Méthode et limites » ; écran de retrait ; brouillons et données gardées sur l'appareil (DSN-32, DSN-33).
- [14 — Exigences transverses](14-exigences-transverses.md) : règles de sécurité ; durée de renouvellement des sauvegardes, qui ne contiennent pas le texte collé ; journal et détails techniques sans données sensibles ; export du journal.

## Hypothèses et questions ouvertes

Renvois au journal : D-20, dont ce document est l'application ; D-02 ; Q-02 (conditions des services gratuits, à relire en cas de partage) ; Q-05 (pari).

- **H-DSN-01 — Longueur d'une description (à confirmer).** Au plus 200 caractères, valeur paramétrable : une phrase suffit à dire le fait, le détail se lit dans la source.
- **H-DSN-02 — Personnes désignées par leur rôle (à confirmer).** Aucune personne autre que le joueur suivi n'est nommée, même publique ; c'est plus strict que nécessaire pour une personnalité publique, mais vérifiable sans ambiguïté.
- **H-DSN-03 — Pas de citation textuelle (à confirmer).** Les propos sont toujours résumés, ce qui évite de reproduire une insulte et rend la règle contrôlable automatiquement.
- **H-DSN-04 — Lien et titre conservés tels que publiés (à confirmer).** Ils identifient la source, comme le prévoit le contrat du résultat de recherche (05), même quand un titre reflète un détail intime publié par la presse.
- **H-DSN-05 — La santé n'est jamais un type (à confirmer).** Une blessure n'intervient que comme indicateur de contexte (D-19, H-09).
- **H-DSN-06 — Affaires judiciaires (à confirmer).** Elles ne sont décrites que par la mention d'une mise en cause publique, sans les faits reprochés.
- **H-DSN-07 — Compteur des retraits (à confirmer).** Un compteur global, sans joueur, sans type et sans date, concilie l'effacement des traces et l'honnêteté des résultats. C'est la seule trace d'un retrait : la trace réduite qu'une suppression pour « donnée sensible » laisserait dans l'import d'un joueur, ou un décompte des événements retirés dans son profil, désignerait le joueur et n'est pas gardée.
- **H-DSN-08 — Descriptions en français (à confirmer).** Elles s'affichent dans l'interface, qui est en français (H-11).
- **H-DSN-09 — Description courte admise (à confirmer).** D-20 ne cite que le type, la date et le lien vers la source. Une description d'une phrase, factuelle et neutre, est admise en plus, parce que le format du résultat de recherche la prévoit (05) et que l'utilisateur doit reconnaître un événement sans ouvrir son lien ; les règles DSN-12 à DSN-23 la bornent.
- **H-DSN-10 — Articles d'un événement retiré (à confirmer).** Ils sont effacés aussitôt, sans trace de dédoublonnage, parce que le lien gardé dans une telle trace peut évoquer le sujet de l'article et désignerait l'événement retiré (DSN-29). En contrepartie, un article encore présent dans un flux peut être collecté de nouveau et faire renaître l'événement : c'est une limite assumée (Q-DSN-01).
- **H-DSN-11 — Brouillon du texte collé (à confirmer).** Le texte collé peut contenir ce que ce document interdit de stocker, si l'IA a mal respecté le prompt ; il n'est gardé que le temps de l'import, pour ne pas faire perdre une recherche à l'utilisateur sur son téléphone (12, H-IHM-08), puis effacé. C'est en ce sens que s'entend « le texte collé n'est pas conservé » (06, H-IMP-10).
- **H-DSN-12 — Types intimes non nommés dans Telegram (à confirmer).** Réponse par défaut à Q-TEL-01 (11) : un type marqué « sujet intime » n'est jamais nommé dans un message, puisque Telegram est un service tiers et qu'un message peut s'afficher sur l'écran verrouillé.
- **Q-DSN-01 — Empreinte d'un événement retiré.** Faut-il conserver une empreinte minimale (joueur, type, date) pour empêcher qu'un backtest ultérieur ou la restauration d'une sauvegarde réintroduise un événement retiré ? Une telle empreinte est elle-même une trace, contraire à l'esprit du retrait ; sans elle, le comptage exhaustif (H-01) et le retrait peuvent se contredire à chaque nouvel import. Sans réponse, aucune empreinte n'est gardée, pas même la trace de dédoublonnage des articles (DSN-34) : un article encore présent dans un flux, un nouvel article ou un nouvel import peuvent rapporter de nouveau le fait ; l'utilisateur ne l'enregistre pas dès l'aperçu d'import (06, IMP-37) ou le retire de nouveau.
