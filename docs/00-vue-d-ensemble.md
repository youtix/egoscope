# 00 — Vue d'ensemble

## Objet

Ce document présente Egoscope dans son ensemble : ce que l'application cherche à établir, l'hypothèse qui la fonde et ses limites, ce qu'elle fait et ne fait pas dans sa première version, le parcours complet d'un événement, les objets qu'elle manipule et le vocabulaire commun. Il sert de porte d'entrée : chaque fonction y est située, puis renvoyée au document qui la possède. Il ne fixe aucune règle détaillée qui appartient à un autre document.

## Décisions d'origine

Ce document s'appuie sur l'ensemble du [90 — Journal des décisions](90-journal-des-decisions.md), qui fait foi. Les entrées suivantes fondent directement son contenu ; les autres sont reprises par les documents qui les mettent en œuvre.

- D-01 — L'hypothèse n'est pas tenue pour acquise : elle se vérifie par l'historique (backtest).
- D-02 — Outil personnel : un seul utilisateur, sans diffusion ni commercialisation.
- D-03 et D-33 — Un seul sport, la NBA, confirmée malgré des exemples venus du football.
- D-04 — L'objet d'étude est la performance individuelle du joueur, pas le résultat du match.
- D-05 — L'application restitue un score d'impact chiffré et sourcé, pas de simples alertes brutes ni une recommandation de pari.
- D-07 bis — Toute l'application est gratuite.
- D-08 — Objectif recentré : détecter si un joueur est sensible à un événement ; pas de pari à ce stade.
- D-09 — Le backtest passe par une recherche approfondie que l'utilisateur exécute lui-même.
- D-11 — Deux niveaux d'analyse : tendance générale par type, affinée par joueur, avec un niveau de confiance.
- D-12 — L'IA propose les types d'événements, l'utilisateur les valide.
- D-22 — Une application minimale d'abord, dans laquelle se fait la validation de l'hypothèse.
- D-24 — Une application en deux parties : détection quotidienne, puis recherche approfondie manuelle.
- D-27 — Les statistiques sont récupérées par l'application, jamais par la recherche approfondie.
- D-29 — Fiche d'alerte complète et suivi automatique du match pour un joueur déjà profilé.
- D-31 — Hypothèse conditionnelle : l'effet suppose du talent et un égo sensible.
- D-32 — Les convictions de l'utilisateur reposent sur des exemples marquants, pas sur des données chiffrées.
- D-35 — Aucun critère d'arrêt, mais un tableau de validation honnête.
- D-36 — Les backtests sont demandés au fil des détections, sans lot initial.
- H-01, H-02 et H-04 — Comptage exhaustif, match mesuré, effet mesuré dans les deux sens.
- H-07 — Un événement détecté est suivi même quand le joueur n'a pas de backtest.
- H-12 — Le découpage en deux lots.
- Q-05, Q-06 et Q-07 — Pari, événements d'équipe et autres sports, hors de la première version.

## Vision

Egoscope cherche à établir, joueur par joueur, si un événement public qui touche l'égo d'un joueur NBA est suivi d'une performance individuelle différente de son niveau habituel. Pour chaque joueur, l'application fait reconstituer l'historique de ces événements, mesure ses performances aux matchs qui les ont suivis et en tire un profil de sensibilité par type d'événement. Elle met ensuite ces profils à l'épreuve en conditions réelles : chaque nouvel événement repéré dans la presse est suivi jusqu'au match, et la performance du joueur à ce match conforte ou dément son profil. Les résultats sont toujours chiffrés, sourcés et accompagnés de leur niveau de confiance, la confiance du profil (D-05, D-11) ; quand les données ne permettent pas de conclure, l'application le dit.

### L'idée d'origine et son recentrage

L'idée de départ était une application qui cherche sur le web les événements susceptibles de toucher l'égo d'un athlète (humiliation, racisme subi, anniversaire, approche d'un record historique, mort d'un proche, conflit entre joueurs, tourmente médiatique), en partant de l'idée qu'un athlète piqué dans son égo joue mieux au match suivant, ce qui augmenterait les chances de gagner un pari sportif sur lui.

Au fil du cadrage, l'idée a été recentrée : Egoscope est d'abord un détecteur de sensibilité par joueur (D-08). Le pari sort du périmètre de la première version : une hausse par rapport à la moyenne de saison ne prouve pas qu'un pari serait rentable, et la comparaison aux lignes des bookmakers reste à étudier plus tard (Q-05). Aucune fonction ne recommande un pari ni ne manipule de cotes.

## Hypothèse de fond et limites

### Une hypothèse conditionnelle

L'hypothèse mise à l'épreuve est la suivante : certains joueurs NBA jouent mieux que d'habitude au premier match qui suit un événement public touchant leur égo. Le raisonnement de l'utilisateur est qu'un joueur touché dans son égo prépare son match plus sérieusement et se montre plus motivé (D-31). Elle repose sur des exemples marquants cités par l'utilisateur (D-32) : un attaquant de football qui répond à des critiques racistes par des doublés, une équipe humiliée qui gagne largement le match suivant, une star qui évite un 4-0 historique en série.

L'hypothèse est conditionnelle. L'effet n'est attendu que chez des joueurs qui réunissent deux traits : du talent, et un égo sensible, c'est-à-dire que la critique les touche (D-31). L'application ne cherche donc pas une loi valable pour tous : elle cherche quels joueurs, et pour quels types d'événements, montrent un effet. Le backtest sert précisément à repérer ces joueurs. La tendance générale d'un type, calculée tous joueurs confondus, sert de repère tant qu'un joueur n'a pas assez de cas pour un verdict qui lui soit propre (D-11, H-03).

Rien n'est tenu pour acquis (D-01). Le calcul est symétrique : un joueur qui joue moins bien après un type d'événement présente une sensibilité négative, mesurée et affichée au même titre qu'une sensibilité positive (H-04).

### Limites connues, assumées par l'utilisateur

Ces limites figurent au journal des décisions ; elles sont reprises telles quelles.

- L'hypothèse n'est pas démontrée : elle repose aujourd'hui sur des exemples mémorables, donc biaisés (D-32).
- Les échantillons par joueur seront petits : un joueur vit peu d'événements de chaque type dans une carrière.
- Aucun critère d'arrêt n'est fixé (D-35).
- La première alerte d'un joueur arrivera souvent trop tard pour être exploitée (D-36).
- Un contexte de fort enjeu (match éliminatoire) pousse tous les joueurs à se surpasser et peut imiter un effet d'égo (D-19).

### Garde-fous et documents qui les portent

Les règles suivantes empêchent l'application de se raconter une belle histoire. Elles sont détaillées dans les documents indiqués et ne sont pas redéfinies ici.

- **Comptage exhaustif** (H-01) : un backtest rapporte tous les événements du joueur, y compris ceux qui ont été suivis d'une contre-performance. Voir [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) et [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md).
- **Événement connu avant le match** (D-10, H-02) : seules comptent des sources datées, publiées avant le match, et l'effet se mesure au premier match joué après que l'événement est devenu public. Voir 05, 06 et [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md).
- **Cas douteux exclus** (D-19) : un cas faussé par un facteur parasite ne compte pas. Voir 08.
- **Effet mesuré dans les deux sens** (H-04) et rapporté à la variabilité habituelle du joueur (D-16). Voir 08.
- **Types nets et datables**, définis sans regarder ce qui s'est passé au match. Voir [02 — Taxonomie des événements](02-taxonomie-des-evenements.md).
- **Épreuve en conditions réelles** (D-29, D-35) : les cas suivis confortent ou démentent les profils ; seuls comptent comme tests ceux qui ont été enregistrés avant le coup d'envoi de leur match, jugés contre un pronostic figé avant ce match. Voir [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md).
- **Traçabilité des retouches** : la modification d'un type, l'écartement d'un événement détecté et le retrait d'un événement laissent une trace chiffrée. Voir 02, 04 et [13 — Données sensibles](13-donnees-sensibles.md).

### Points de vigilance ajoutés à la rédaction

Les deux points suivants ne viennent pas du journal : ils découlent de la méthode et sont signalés pour la lecture des résultats.

- **Population choisie** : les joueurs suivis sont retenus pour leur talent et leur exposition médiatique (D-17, D-31). La tendance générale décrit cette population, pas l'ensemble des joueurs NBA.
- **Profils nombreux** : avec 20 à 30 joueurs et plusieurs types, certains profils paraîtront sensibles par le seul effet du hasard. L'application affiche, à côté de la liste des profils, le nombre de verdicts que le hasard seul produirait (08), mais seuls les cas suivis, observés après l'établissement d'un profil, permettent de distinguer un effet d'une coïncidence (voir Q-VUE-01).

## L'utilisateur et son rôle dans la boucle

Egoscope a un seul utilisateur (D-02), qui accède à l'application par un compte unique (H-10 ; écrans : [12 — Interface et accès](12-interface-et-acces.md) ; règles de sécurité : [14 — Exigences transverses](14-exigences-transverses.md)). L'application n'est pas autonome : plusieurs étapes reposent sur l'utilisateur, et c'est voulu.

- Il choisit les joueurs suivis et tient la liste à jour (voir [01 — Joueurs suivis](01-joueurs-suivis.md)).
- Il est seul à valider un type d'événement ; l'IA ne fait que proposer (D-12, voir 02).
- Il lance lui-même chaque recherche approfondie : il copie le prompt de recherche produit par l'application, le colle dans une IA de recherche approfondie gratuite de son choix, attend la réponse, puis colle le JSON obtenu dans l'application (D-09, voir 05 et 06).
- Il vérifie l'aperçu de chaque import et corrige au besoin les données, notamment les indications de contexte (H-09, voir 06).
- Au lot 2, il écarte les événements détectés à tort, sans avoir à valider chaque événement avant qu'une alerte parte (H-08, voir [04 — Détection des événements](04-detection-des-evenements.md)).
- Il peut retirer tout événement, détecté ou historique, pour une raison de sensibilité (voir 13).
- Il lit les profils, les fiches d'alerte et le tableau de validation, et tire lui-même ses conclusions : aucun seuil n'arrête le projet (D-35).

Il ne saisit aucune statistique : l'application les récupère elle-même (D-27). Sa disponibilité règle en revanche le rythme des backtests : un match peut être joué avant que la recherche soit faite, risque accepté (D-36).

## Périmètre de la première version

### Dans le périmètre

- Le basket NBA, et lui seul (D-03, D-33).
- Une liste de 20 à 30 joueurs suivis, talentueux et très médiatisés (D-17), saisie par l'utilisateur (Q-03), dont la taille est paramétrable. Voir 01.
- Des types d'événements nets et datables, proposés par une IA et validés par l'utilisateur (D-06, D-12). Voir 02.
- La collecte quotidienne de la presse sportive, anglophone et francophone, et la détection des événements par un modèle de langage gratuit (D-15, D-26, H-11). Voir [03 — Collecte des actualités](03-collecte-des-actualites.md) et 04.
- Le backtest par recherche approfondie manuelle, avec un prompt qui impose un retour en JSON strict (D-09, D-14). Voir 05 et 06.
- La récupération des statistiques de match par l'application, auprès d'une source gratuite (D-27). Voir [07 — Statistiques de match](07-statistiques-de-match.md).
- Le calcul de la sensibilité par joueur et par type, la tendance générale et le verdict à trois niveaux (D-11, D-13, D-16). Voir 08.
- La fiche d'alerte, le suivi automatique du match et le tableau de validation (D-29, D-35). Voir [09 — Fiche d'alerte](09-fiche-d-alerte.md) et 10.
- Les notifications sur Telegram (D-30). Voir [11 — Notifications Telegram](11-notifications-telegram.md).
- Une application web installable sur téléphone, de type PWA, à compte unique (D-25, H-10). Voir 12.
- Des règles strictes sur les données sensibles (D-20). Voir 13.
- Une pile en JavaScript ou TypeScript, une base relationnelle hébergée à palier gratuit (D-18, D-23, D-28), une gratuité de bout en bout (D-07 bis) et un déploiement décrit pour un utilisateur dont le niveau technique n'est pas connu (Q-01). Voir [14 — Exigences transverses](14-exigences-transverses.md).

### Hors périmètre

- Tout ce qui touche au pari : recommandation, cotes, lignes des bookmakers, calcul de gains (D-08, Q-05).
- Les événements qui touchent toute une équipe sans viser un joueur (Q-06).
- Les autres sports et les autres ligues (Q-07), sans fermer la porte.
- Le résultat du match comme mesure : seule compte la performance individuelle (D-04).
- Le lancement automatique des recherches approfondies : l'utilisateur les exécute (D-09).
- Toute statistique fournie par la recherche approfondie (D-27).
- Un lot initial de backtests couvrant toute la liste (D-36).
- Les sources non publiques et les détails intimes (D-20).
- Le partage, la diffusion et la commercialisation de l'outil (D-02).
- Tout service payant (D-07 bis).
- Un arrêt automatique du projet selon les résultats (D-35).

## Les deux parties de l'application

L'application se compose de deux parties (D-24).

1. **La veille quotidienne.** Chaque jour, une tâche planifiée collecte des articles de presse, puis un modèle de langage gratuit repère ceux qui rapportent un fait touchant l'égo d'un joueur suivi et les rattache à un type validé (D-15, D-26). Voir 03 et 04.
2. **Le backtest.** Quand un événement est détecté pour un joueur qui n'a pas encore de backtest, l'application demande une recherche approfondie ; l'utilisateur l'effectue manuellement dans une IA, colle le résultat, et l'application le stocke (D-24). Elle récupère ensuite elle-même les statistiques des matchs concernés et calcule le profil de sensibilité du joueur (D-27). Voir 05 à 08.

Les deux parties se rejoignent sur les cas suivis. Tout événement détecté est enregistré et son match suivi, que le joueur ait un backtest ou non (H-07) : il devient un cas réel de son profil, présent ou futur (D-29). Ce qui l'accompagne dépend du joueur, selon l'aiguillage décrit dans 04 :
- joueur non profilé : une demande de backtest (05), sans fiche d'alerte ;
- joueur profilé dont la couverture comprend le type de l'événement : une fiche d'alerte (D-29, voir 09) ;
- joueur profilé dont la couverture ne comprend pas ce type : une fiche d'alerte portant la mention « type non couvert par le backtest », et une demande complémentaire (05).

L'ordre de construction est l'inverse de l'ordre du parcours : le lot 1 livre d'abord la seconde partie, déclenchée à la main, parce que c'est elle qui permet de vérifier l'hypothèse (D-22) ; le lot 2 ajoute la veille quotidienne et ce qui en dépend (H-12).

## Parcours de bout en bout

Le parcours nominal suit un événement depuis sa parution dans la presse jusqu'à la validation du profil. Chaque étape indique le lot qui la livre et le document qui la possède.

1. **Collecte** (lot 2). Chaque jour, à une heure paramétrable, une tâche planifiée lit les flux des sources de presse choisies par l'utilisateur, date chaque article avec prudence, élimine les doublons et ne garde que le strict nécessaire ; les pannes de flux et les trous de collecte restent visibles. Voir 03.
2. **Détection** (lot 2). Un préfiltrage, sans consommer de quota, ne retient que les articles qui citent un joueur suivi actif ; un modèle de langage gratuit les classe d'après les seules fiches des types validés, avec une confiance de détection comparée à un seuil. Les articles qui rapportent le même fait forment un seul événement détecté, daté de sa première publication connue ; un fait sans type validé devient une proposition de type (02). Tout événement détecté est confié au suivi : son cas naît « en attente du match » (10). Puis l'événement est aiguillé vers la demande de backtest ou la fiche d'alerte, selon la situation du joueur (voir « Les deux parties de l'application »). Voir 04.
3. **Demande de backtest** (lot 1 à la main, lot 2 sur détection). L'application crée une demande, initiale ou complémentaire, sans jamais en ouvrir deux à la fois pour un même joueur ; elle porte les types validés à couvrir et leurs périodes, le prompt de recherche, et affiche l'échéance du prochain match du joueur (H-07). Au lot 1, l'utilisateur la déclenche lui-même. Voir 05.
4. **Recherche manuelle** (lot 1). L'utilisateur copie le prompt, le colle dans une IA de recherche approfondie et lance la recherche. Le prompt exige tous les événements de la carrière NBA du joueur pour les types demandés (H-01, H-05, H-06), des sources publiées avant le match qui a suivi (D-10), aucune statistique (D-27) et un retour en JSON strict (D-14). Voir 05.
5. **Import** (lot 1). L'utilisateur colle le résultat de recherche ; l'application isole le JSON, le contrôle, signale les doublons et l'antériorité des sources, en montre un aperçu, puis, après confirmation, enregistre les événements historiques et la couverture du joueur ; la demande passe à « importée ». Voir 06.
6. **Statistiques** (lot 1). L'application récupère le calendrier et les feuilles de match, calcule l'indice de performance de chaque match et la référence de saison du joueur (D-13, H-13), en tenant compte de ses quotas. Voir 07.
7. **Profil de sensibilité** (lot 1). Chaque événement est rattaché à son match mesuré pour former un cas ; l'application calcule l'écart normalisé, exclut les cas douteux, puis établit le profil du joueur pour chaque type, la tendance générale de chaque type, le verdict et la confiance du profil (D-11, D-16, D-19, H-02, H-03). Voir 08.
8. **Alerte** (lot 2). Quand un joueur profilé vit un nouvel événement détecté, l'application produit une fiche d'alerte complète (événement et sources, sensibilité à ce type avec écart moyen, nombre de cas et confiance du profil, prochain match, réserves), dont les valeurs sont figées à l'émission, et la notifie sur Telegram (D-29, D-30). Voir 09 et 11.
9. **Suivi du match** (lot 2). Au coup d'envoi, le pronostic du cas suivi, tiré des seuls cas historiques, est figé. Une fois le match joué, l'application récupère la feuille de match, fait mesurer le cas selon les règles de 08, le classe au regard de ce pronostic, ajoute le cas valide au profil et notifie le résultat (D-29). Voir 10 et 11.
10. **Validation** (lot 2). Le tableau de validation confronte les profils établis sur les cas historiques aux cas suivis enregistrés avant le coup d'envoi de leur match ; un cas enregistré après ne compte jamais comme test. Le tableau n'arrête rien (D-35). Voir 10.

### Variantes

- **Joueur sans backtest** : l'étape 2 mène à l'étape 3 ; l'événement est enregistré et son match suivi (étape 9), même si le backtest n'est pas prêt à temps (H-07, D-36). Si le résultat de recherche est importé avant le coup d'envoi, la fiche d'alerte de cet événement est produite à ce moment (09).
- **Joueur déjà profilé** : l'étape 2 mène aux étapes 8, 9 et 10 ; si sa couverture ne comprend pas le type de l'événement, la fiche porte la mention « type non couvert par le backtest » et une demande complémentaire est créée ou proposée (H-05, voir 05).
- **Événement détecté à tort** : l'utilisateur l'écarte ; l'événement est conservé mais sort de tous les calculs, et l'écartement est réversible. On n'écarte jamais un événement parce que le match a été mauvais (H-08). Voir 04.
- **Événement retiré** : pour une raison de sensibilité, l'utilisateur efface un événement et ses traces ; seul un compteur global en garde le nombre. Voir 13.
- **Fait sans type correspondant** : la détection le transmet comme proposition de nouveau type, que l'utilisateur valide ou rejette ; si le type est validé, les articles liés sont reclassés par la détection. Voir 02 et 04.
- **Lot 1 seul** : le parcours commence à l'étape 3, déclenchée à la main, et s'arrête à l'étape 7.

## Objets métier et relations

### Objets

- **Joueur suivi** : joueur NBA choisi par l'utilisateur. Il porte un identifiant stable, une identité (nom d'usage, variantes de nom, équipe actuelle, correspondance avec la source de statistiques) et un état : actif, en pause ou retiré. Voir 01.
- **Type d'événement** : catégorie décrite par une fiche. Il passe par les états proposé, validé, rejeté et retiré ; seuls les types validés servent. Voir 02.
- **Article** : contenu de presse récupéré par un flux, gardé le temps strictement nécessaire. Voir 03 et 13.
- **Événement** : fait public et daté concernant un joueur suivi. Il porte un joueur, un type avec la version de fiche sous laquelle il a été qualifié, une date de référence avec sa précision, une ou plusieurs sources, une description courte et neutre, des indications de contexte et une confiance : confiance de détection ou confiance de la recherche selon son origine. Il est soit détecté (états détecté ou écarté), soit historique. Un événement détecté porte en outre son article de référence et, le cas échéant, les marques « datation à vérifier » et « détecté après le coup d'envoi » (04) ; un événement historique porte l'antériorité de ses sources (06). La liste complète de ce qu'il peut porter est fixée par 13. Voir 04, 06 et 13.
- **Demande de backtest** : demande faite à l'utilisateur pour un joueur. Elle porte sa nature (initiale, complément ou reprise complète), son déclencheur, les types demandés avec leurs périodes et le prompt de recherche ; elle affiche l'échéance du prochain match ; ses états sont à faire, importée, annulée. Voir 05.
- **Couverture** : pour chaque joueur, les types et les périodes déjà couverts par un résultat de recherche importé. Voir 05.
- **Résultat de recherche** : JSON collé par l'utilisateur, qui rapporte des événements, jamais de statistiques. Voir 05 et 06.
- **Match et feuille de match** : un match NBA daté et la ligne statistique du joueur pour ce match, dont l'application tire l'indice de performance. Voir 07.
- **Référence de saison** : moyenne et écart-type de l'indice de performance d'un joueur sur une saison. Voir 07.
- **Cas** : un événement et son match mesuré ; historique ou suivi ; ses états sont en attente du match, mesuré, exclu (cas douteux), non mesurable. Un cas suivi porte en outre son pronostic figé et sa catégorie (10). Voir 08 et 10.
- **Profil de sensibilité** et **tendance générale** : résultats du calcul, pour un joueur et un type, ou pour un type tous joueurs confondus. Voir 08.
- **Fiche d'alerte** : restitution produite pour un joueur profilé qui vit un nouvel événement ; elle est ouverte, close ou annulée, et peut être tardive. Voir 09.
- **Notification** : message envoyé à l'utilisateur sur Telegram. Voir 11.
- **Tableau de validation** : vue qui confronte les profils aux cas suivis. Voir 10.
- **Paramètres** : valeurs réglables (seuils, délais, tailles de liste), chacune avec sa valeur par défaut. Voir 14.

### Relations

- Un joueur suivi a zéro, un ou plusieurs événements ; chaque événement concerne un seul joueur suivi.
- Chaque événement relève d'un seul type d'événement ; un type regroupe les événements de tous les joueurs.
- Un événement détecté s'appuie sur un ou plusieurs articles ; un événement historique s'appuie sur une ou plusieurs sources citées par un résultat de recherche.
- Une demande de backtest concerne un seul joueur et porte, pour une demande initiale, sur les types validés à sa date (H-05) ; chaque import enrichit la couverture du joueur et y ajoute des événements historiques. Un joueur a au plus une demande à faire.
- Un événement donne au plus un cas : il est rattaché au premier match joué par le joueur après être devenu public (H-02). Plusieurs événements d'un même type rattachés au même match forment un seul cas ; des événements de types différents rattachés au même match donnent des cas concomitants. Voir 08.
- Un profil de sensibilité réunit les cas valides d'un joueur pour un type ; la tendance générale réunit les cas valides d'un type pour tous les joueurs suivis.
- Une fiche d'alerte naît d'un ou de plusieurs événements détectés d'un joueur profilé avant un même match ; elle reprend le profil du joueur pour chaque type concerné et annonce son prochain match.
- Le tableau de validation confronte les profils établis sur les cas historiques aux cas suivis enregistrés avant le coup d'envoi de leur match.

## Glossaire

Les termes suivants sont communs à tous les documents et s'emploient tels quels.

- **Joueur suivi** : joueur NBA inscrit dans la liste de suivi.
- **Type d'événement** : catégorie d'événement définie par une fiche validée par l'utilisateur.
- **Fiche de type** : définition, critères d'inclusion, critères d'exclusion, exemple.
- **Article** : contenu de presse récupéré par un flux d'actualités.
- **Événement** : fait public et daté concernant un joueur suivi, susceptible de toucher son égo, rattaché à un type d'événement. Sa date de référence est le moment où il devient public.
- **Événement détecté** : événement repéré par la détection quotidienne.
- **Événement historique** : événement passé rapporté par un backtest.
- **Backtest** : reconstitution de tous les événements passés d'un joueur, suivie de la mesure de ses performances aux matchs concernés.
- **Demande de backtest** : demande faite à l'utilisateur de lancer une recherche approfondie pour un joueur.
- **Prompt de recherche** : texte produit par l'application, que l'utilisateur colle dans une IA de recherche approfondie.
- **Résultat de recherche** : JSON renvoyé par cette IA et collé par l'utilisateur dans l'application.
- **Match mesuré** : premier match joué par le joueur après que l'événement est devenu public.
- **Cas** : association d'un événement et de son match mesuré. C'est l'unité de calcul. Un cas est **historique** (issu d'un backtest) ou **suivi** (issu d'un événement détecté, observé en conditions réelles).
- **Indice de performance** : Game Score du match divisé par les minutes jouées (H-13).
- **Référence de saison** : moyenne et écart-type de l'indice de performance du joueur sur la saison.
- **Écart normalisé** : (indice de performance du match mesuré − moyenne de saison) ÷ écart-type de saison.
- **Cas douteux** : cas exclu des calculs à cause d'un facteur parasite.
- **Profil de sensibilité** : pour un joueur et un type d'événement : nombre de cas valides, écart normalisé moyen, verdict, niveau de confiance.
- **Tendance générale** : même calcul pour un type d'événement, tous joueurs confondus.
- **Verdict** : probable, possible ou non concluant.
- **Fiche d'alerte** : restitution complète produite quand un joueur profilé vit un nouvel événement.
- **Tableau de validation** : vue qui confronte les profils aux cas suivis.

### États communs

- Type d'événement : proposé, validé, rejeté, retiré.
- Joueur suivi : actif, en pause, retiré.
- Événement détecté : détecté, écarté.
- Demande de backtest : à faire, importée, annulée.
- Cas : en attente du match, mesuré, exclu (cas douteux), non mesurable.

### Termes complémentaires

Ces termes complètent le glossaire commun sans le modifier. Chacun est défini par le document indiqué, qui fait foi ; la ligne ci-dessous n'en est que le résumé.

- **Antériorité** : pour un événement historique, résultat de la comparaison entre ses sources et le coup d'envoi de son match mesuré : établie, incertaine, non établie, ou à vérifier tant que les dates de matchs manquent ; une antériorité non établie ou à vérifier ne produit aucun cas compté. Voir [06](06-import-des-resultats-de-recherche.md) (IMP-18).
- **Bilan** : conclusion d'une ligne du tableau de validation, calculée seulement au-delà d'un nombre minimal de cas suivis avec pronostic : confirmé, confirmé avec un effet plus faible qu'annoncé, démenti ou indécis. Voir [10](10-suivi-automatique-et-validation.md) (SUI-26, SUI-27).
- **Cas concomitant** : cas dont le match mesuré est aussi celui d'un événement d'un autre type ; il compte dans le profil de chacun de ces types et porte cette marque. Voir [08](08-sensibilite-et-verdict.md) (SEN-06).
- **Cas enregistré à temps** : cas suivi créé avant le coup d'envoi prévu de son match mesuré ; seuls ces cas testent l'hypothèse, les autres étant comptés à part comme « enregistrés après le coup d'envoi ». Voir [10](10-suivi-automatique-et-validation.md) (SUI-06).
- **Cas valide** : cas à l'état « mesuré », dont l'écart normalisé est calculé sans qu'aucun critère de cas douteux soit retenu ; seuls les cas valides entrent dans un verdict. Voir [08](08-sensibilite-et-verdict.md) (SEN-07).
- **Catégorie d'un cas suivi** : classement d'un cas suivi valide au regard de son pronostic figé : confirmé, démenti, neutre ou sans pronostic. Voir [10](10-suivi-automatique-et-validation.md) (SUI-22).
- **Complément** (ou demande complémentaire) : demande de backtest qui ne porte que sur ce que la couverture du joueur ne comprend pas encore : type validé depuis, période écoulée, manque laissé par un import. Voir [05](05-demande-de-backtest-et-prompt.md) (BKT-04 à BKT-06, BKT-09).
- **Confiance de détection** : note de 0 à 100 que la classification attache à un fait, auto-évaluation du modèle et non probabilité ; sous le seuil de détection, aucun événement n'est créé. Voir [04](04-detection-des-evenements.md) (DET-24, DET-25).
- **Confiance de la recherche** : niveau haute, moyenne ou faible que l'IA de recherche attribue à chaque événement historique selon la règle du prompt ; son poids dans les calculs relève de 08 (Q-BKT-01). Voir [05](05-demande-de-backtest-et-prompt.md) (règle 2.8 du prompt, H-BKT-07).
- **Confiance du profil** : niveau faible, moyen ou élevé attaché à un profil de sensibilité ou à une tendance générale, qui dit sur quelle base repose son verdict ; c'est le « niveau de confiance » du glossaire commun. Voir [08](08-sensibilite-et-verdict.md) (SEN-25).
- **Correspondance statistique** : lien, confirmé par l'utilisateur, entre un joueur suivi et sa fiche dans la source de statistiques. Voir [01](01-joueurs-suivis.md) (JOU-10).
- **Couverture** : pour un joueur, les types et les périodes déjà couverts par un résultat de recherche importé, même vide ; un joueur sans aucune période couverte est « sans backtest », c'est-à-dire non profilé, les autres sont « déjà traités », c'est-à-dire profilés. Voir [05](05-demande-de-backtest-et-prompt.md) (BKT-10).
- **Dispersion retenue** : variabilité des écarts d'un profil retenue pour le verdict, jamais inférieure à la variabilité habituelle du joueur, pour que peu de cas ne paraissent pas plus sûrs qu'ils ne sont. Voir [08](08-sensibilite-et-verdict.md) (SEN-22).
- **Écartement** : geste par lequel l'utilisateur corrige une erreur de détection ; l'événement détecté passe à l'état « écarté » et sort de tous les calculs sans être effacé ; réversible, il ne dépend jamais du résultat du match. Voir [04](04-detection-des-evenements.md) (DET-43 à DET-46).
- **États d'une fiche d'alerte** : ouverte tant qu'un de ses événements attend son match, close quand leurs cas sont mesurés, exclus ou non mesurables, annulée quand tous ses événements sont écartés ou qu'une correction de rattachement ne lui laisse plus d'événement pour ce joueur ; la marque « tardive » s'y ajoute. Voir [09](09-fiche-d-alerte.md) (ALE-26, ALE-31).
- **États de la référence de saison** : définitive, provisoire, en constitution ou insuffisante, avec le cas échéant la mention « partielle » ; seule une référence définitive ou provisoire permet de mesurer un cas. Voir [07](07-statistiques-de-match.md) (STA-16, STA-19 à STA-24).
- **Feuille de match** : statistiques individuelles d'un joueur pour un match, à partir desquelles se calcule le Game Score. Voir [07](07-statistiques-de-match.md) (STA-08).
- **Fiche tardive** : fiche d'alerte produite, ou complétée des valeurs du profil, après le coup d'envoi de son match mesuré ; elle est gardée pour l'historique et la validation. Voir [09](09-fiche-d-alerte.md) (ALE-24).
- **Fourchette plausible** : intervalle de deux fois le bruit attendu de part et d'autre de l'écart moyen, affiché avec lui pour montrer l'incertitude due au nombre de cas. Voir [08](08-sensibilite-et-verdict.md) (SEN-22).
- **Instant de référence** : moment où un événement est réputé devenu public, à partir duquel se cherche son match mesuré ; une date sans heure est, par prudence, reportée en fin de journée, sauf pour un événement connu à l'avance. Voir [08](08-sensibilite-et-verdict.md) (SEN-01, SEN-02).
- **Joueur profilé** : joueur suivi pour lequel au moins un résultat de recherche a été importé, même vide (H-VUE-02) ; sa couverture dit si le type d'un nouvel événement est couvert, ce qui fixe le contenu de la fiche d'alerte (09).
- **Liste « à faire »** : regroupement, dans l'application, des actions qui attendent l'utilisateur. Voir [12](12-interface-et-acces.md) (IHM-20).
- **Lot** : tranche de livraison de l'application ; il y en a deux (H-12).
- **Match exploitable** : match joué dont la feuille est complète et cohérente et où le joueur a atteint le seuil de temps de jeu ; seuls ces matchs entrent dans une référence de saison. Voir [07](07-statistiques-de-match.md) (STA-14).
- **Passage** : une exécution d'une tâche planifiée, par exemple la collecte et la détection du jour ou la récupération des statistiques après les matchs. Voir [11](11-notifications-telegram.md) ; tâches planifiées : [14](14-exigences-transverses.md) (TRV-25).
- **Plage de silence** : plage horaire réglée par l'utilisateur pendant laquelle aucun message Telegram ne part, sauf urgence avant un match ; les messages différés partent groupés à sa fin. Voir [11](11-notifications-telegram.md) (TEL-20, TEL-21).
- **Pronostic figé** : pour un cas suivi, dernière version, antérieure au coup d'envoi de son match mesuré, du verdict tiré des seuls cas historiques (profil du joueur s'il atteint le seuil de cas de H-03, sinon tendance générale) ; c'est contre lui que le cas est jugé. Voir [10](10-suivi-automatique-et-validation.md) (SUI-08, SUI-09).
- **Pronostic tardif** : pronostic d'un cas suivi resté sans pronostic au coup d'envoi, faute de backtest importé ou de cas historiques déjà mesurés, calculé dès que ce profil existe et compté à part, car le résultat du cas était déjà connu. Voir [10](10-suivi-automatique-et-validation.md) (SUI-10).
- **Prompt d'exploration** : texte produit par l'application, que l'utilisateur colle dans une IA de recherche approfondie pour obtenir des propositions de types nets et datables. Voir [02](02-taxonomie-des-evenements.md) (TAX-16).
- **Proposition de type** : type d'événement à l'état proposé ; sa fiche n'est pas encore validée et il ne sert à aucun calcul. Voir [02](02-taxonomie-des-evenements.md) (TAX-15 à TAX-18).
- **Rapport signal sur bruit** : écart moyen d'un profil divisé par le bruit attendu, c'est-à-dire par l'ampleur que le hasard donne couramment à une moyenne de ce nombre de cas ; le verdict en dépend. Voir [08](08-sensibilite-et-verdict.md) (SEN-22, SEN-23).
- **Recherche approfondie** : mode d'une IA qui explore longuement le web et rend un résultat sourcé ; l'utilisateur l'emploie hors de l'application.
- **Refus restants** : événements refusés lors du dernier import d'une demande, qui manquent au backtest tant qu'ils n'ont pas été corrigés et réimportés ; ils s'affichent avec la demande et à côté du profil. Voir [06](06-import-des-resultats-de-recherche.md) (IMP-24).
- **Règle de datation** : élément de la fiche de type qui dit comment fixer la date de référence d'un événement de ce type, et si ses événements sont connus à l'avance. Voir [02](02-taxonomie-des-evenements.md) (TAX-01, TAX-05).
- **Reprise complète** : demande de backtest qui refait, pour un joueur déjà traité, tous les types validés sur toute sa carrière ; à l'import, l'utilisateur peut remplacer l'existant. Voir [05](05-demande-de-backtest-et-prompt.md) (BKT-09) et [06](06-import-des-resultats-de-recherche.md) (IMP-29).
- **Retrait (d'un événement)** : effacement définitif, par l'utilisateur et pour une raison de sensibilité, d'un événement et de ses traces ; seul un compteur global en garde le nombre. À ne pas confondre avec l'écartement, avec l'exclusion d'un cas douteux, ni avec le retrait d'un joueur ou d'un type, simple passage à l'état « retiré » qui n'efface rien. Voir [13](13-donnees-sensibles.md) (DSN-26 à DSN-29).
- **Seuil de temps de jeu** : temps de jeu en dessous duquel un match n'est pas exploitable ; un cas dont le match mesuré ne l'atteint pas est un cas douteux. Voir [07](07-statistiques-de-match.md) (STA-14, STA-15) et [08](08-sensibilite-et-verdict.md) (SEN-12).
- **Variantes de nom** : nom d'usage, variantes d'écriture et surnoms sous lesquels la presse désigne un joueur suivi. Voir [01](01-joueurs-suivis.md) (JOU-08, JOU-09).
- **Verdict fragile** : verdict dont le niveau ou le sens change quand on retire le cas qui le soutient le plus ; la confiance du profil baisse alors d'un niveau. Voir [08](08-sensibilite-et-verdict.md) (SEN-26).
- **Version de fiche** : état daté du contenu d'une fiche de type ; chaque événement garde la version sous laquelle il a été qualifié. Voir [02](02-taxonomie-des-evenements.md) (TAX-20 à TAX-23).

## Lots

Le découpage en deux lots est une hypothèse de rédaction (H-12), à confirmer. Chaque exigence de chaque document indique son lot. Les règles sur les données sensibles (13) et les exigences transverses (14) s'appliquent dès le lot 1 aux fonctions de ce lot.

### Lot 1 — L'application minimale

Contenu (H-12, D-22) : joueurs suivis, taxonomie, demande de backtest déclenchée à la main, prompt de recherche, import du JSON, statistiques, calcul de sensibilité, consultation des profils. Faute de détection, les demandes sont déclenchées à la main : l'utilisateur choisit lui-même les joueurs à traiter, et l'application n'en crée aucune d'office pour toute la liste. D-36 prévoit des backtests demandés au fil des détections ; le déclenchement manuel du lot 1 vient de H-12 et reste donc à confirmer.

À la fin du lot 1, l'utilisateur sait :
- se connecter à l'application et saisir ses joueurs suivis ;
- valider ses premiers types d'événements à partir des ébauches de départ et du prompt d'exploration ;
- déclencher à la main une demande de backtest pour un joueur, copier le prompt, lancer lui-même la recherche approfondie et coller le résultat ;
- vérifier l'aperçu, corriger et enregistrer les événements historiques ;
- consulter, pour chaque joueur et chaque type, le nombre de cas valides, l'écart normalisé moyen, le verdict et la confiance du profil, ainsi que la tendance générale de chaque type, en remontant jusqu'aux sources.

Il n'est pas encore prévenu d'un nouvel événement. L'hypothèse ne se vérifie qu'à partir de l'historique, avec les biais décrits plus haut.

### Lot 2 — La veille et l'épreuve des faits

Contenu (H-12) : collecte et détection quotidiennes, demandes de backtest créées sur détection, propositions de types venues de la détection, fiche d'alerte, suivi automatique, tableau de validation, notifications Telegram.

À la fin du lot 2, l'utilisateur sait en plus :
- recevoir sur Telegram les demandes de backtest à faire, avec l'échéance du prochain match ;
- recevoir une fiche d'alerte quand un joueur profilé vit un nouvel événement ;
- écarter un événement détecté à tort ;
- valider ou rejeter les propositions de nouveaux types venues de la détection ;
- voir chaque cas suivi s'ajouter au profil une fois son match mesuré joué ;
- consulter le tableau de validation, qui montre quels profils les cas suivis confortent ou démentent.

## Carte des documents

- [00 — Vue d'ensemble](00-vue-d-ensemble.md) : vision, hypothèse et limites, périmètre, parcours, objets métier, glossaire, lots.
- [01 — Joueurs suivis](01-joueurs-suivis.md) : critères de choix et taille de la liste, identité et correspondance statistique, états actif, en pause et retiré, changement d'équipe et absences, suppression des données, fiche joueur.
- [02 — Taxonomie des événements](02-taxonomie-des-evenements.md) : fiche de type, types nets et datables, cycle de vie, propositions (types candidats, prompt d'exploration, détection), modification, fusion, scission, retrait, ébauches des types candidats.
- [03 — Collecte des actualités](03-collecte-des-actualites.md) : sources de presse et leur essai, collecte quotidienne et rattrapage, datation prudente des articles, dédoublonnage, conservation et purge, pannes et trous de collecte, journal de collecte.
- [04 — Détection des événements](04-detection-des-evenements.md) : préfiltrage sans quota, file d'attente, classification et confiance de détection, regroupement des articles et date de référence, propositions de type, aiguillage, écartement, corrections et repêchage.
- [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) : naissance des demandes et couverture, contenu, états, échéance et rang, texte du prompt de recherche, format JSON avec exemple complet, limites des IA de recherche.
- [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) : collage sur téléphone, contrôles et messages d'erreur, aperçu et import partiel, antériorité, doublons, complément ou remplacement, corrections et suppressions, traçabilité.
- [07 — Statistiques de match](07-statistiques-de-match.md) : source et identité des joueurs, calendrier et résultats, feuilles de match, indice de performance, matchs exploitables, référence de saison, prochain match, horaires, données manquantes et quotas.
- [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) : match mesuré, écart normalisé, cas douteux, profils et tendance générale, verdict et confiance du profil, comptage exhaustif, recalcul, exemple chiffré et pièges d'interprétation.
- [09 — Fiche d'alerte](09-fiche-d-alerte.md) : production, contenu et réserves de la fiche d'alerte, joueur sans profil, type non couvert, mises à jour, clôture avec l'issue, historique des alertes.
- [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) : cas suivis, enregistrement à temps, pronostic figé, mesure et catégorie des cas, résultat communiqué, tableau de validation sans critère d'arrêt.
- [11 — Notifications Telegram](11-notifications-telegram.md) : catalogue des messages, sobriété (regroupement, plage de silence, urgence, plafond), réglages, mise en relation, échecs d'envoi.
- [12 — Interface et accès](12-interface-et-acces.md) : application installable, accès, navigation et écrans, liste « à faire », copier-coller sur téléphone, affichage honnête, hors connexion, accessibilité.
- [13 — Données sensibles](13-donnees-sensibles.md) : presse publique, stockage minimal, sujets intimes, ce qui n'est jamais stocké, formulation des descriptions, retrait d'un événement, usage personnel.
- [14 — Exigences transverses](14-exigences-transverses.md) : gratuité et quotas, critères de choix des services, langage unique, tâches planifiées, registre des paramètres, journalisation, sauvegarde, sécurité, fuseaux horaires, déploiement pas à pas, documentation.
- [90 — Journal des décisions](90-journal-des-decisions.md) : décisions, hypothèses et questions ouvertes ; il fait foi.
- [README](README.md) : index du dossier.

## Exigences d'ensemble

- **VUE-01** [Lot 1] — L'application ne traite que la NBA : joueurs, matchs et statistiques proviennent exclusivement de cette ligue (D-03, D-33, Q-07).
- **VUE-02** [Lot 1] — Aucune fonction, aucun écran ni aucun message ne recommande un pari, n'affiche une cote ou une ligne de bookmaker, ni ne calcule un gain (D-08, Q-05).
- **VUE-03** [Lot 1] — La performance se mesure uniquement par l'indice de performance individuel du joueur (D-04, D-13, H-13) ; la victoire ou la défaite de son équipe ne sert jamais de mesure.
- **VUE-04** [Lot 1] — Tout événement enregistré concerne un et un seul joueur suivi ; un fait qui ne vise qu'une équipe n'est pas un événement (Q-06).
- **VUE-05** [Lot 1] — Tout verdict affiché est accompagné du nombre de cas valides sur lequel il repose et de sa confiance du profil (08), et donne accès aux sources de chacun des événements comptés (D-05, D-11).
- **VUE-06** [Lot 1] — Le lot 1 fonctionne seul, de l'ajout d'un joueur à la consultation de son profil, sans aucune fonction du lot 2 (D-22, H-12).
- **VUE-07** [Lot 1] — L'application ne lance jamais elle-même une recherche approfondie : elle produit le prompt et attend le résultat collé par l'utilisateur (D-09).
- **VUE-08** [Lot 1] — Les écrans et les messages emploient les termes du glossaire et les états communs tels qu'ils sont écrits dans ce document.
- **VUE-09** [Lot 1] — L'application comporte une page « Méthode et limites » qui expose, en termes compréhensibles sans connaissance statistique, l'hypothèse conditionnelle, les limites connues, les points de vigilance de ce document et le compteur des événements retirés tenu par 13 (H-VUE-01). Sa place dans la navigation relève de 12.
- **VUE-10** [Lot 2] — Un événement détecté pour un joueur profilé franchit, sans action requise de l'utilisateur, les étapes 8 à 10 du parcours : fiche d'alerte, suivi du match, prise en compte du cas suivi dans le profil et dans le tableau de validation (D-29, D-35).

## Critères d'acceptation

1. (VUE-01) Étant donné un joueur suivi qui a aussi joué hors de la NBA, par exemple avec une sélection nationale, quand l'application récupère ses matchs, alors seuls ses matchs NBA sont retenus et peuvent servir de match mesuré.
2. (VUE-02) Étant donné n'importe quel écran de l'application ou n'importe quel message Telegram, quand l'utilisateur le lit, alors il n'y trouve ni cote, ni ligne de bookmaker, ni recommandation de pari, ni calcul de gain.
3. (VUE-03) Étant donné deux cas valides de même écart normalisé, l'un joué lors d'une victoire de l'équipe du joueur et l'autre lors d'une défaite, quand le profil est calculé, alors les deux cas pèsent exactement de la même façon.
4. (VUE-04) Étant donné un événement enregistré, quelle que soit son origine, quand l'utilisateur ouvre son détail, alors il y lit un seul joueur suivi concerné.
5. (VUE-05) Étant donné un profil qui affiche un verdict, quand l'utilisateur le consulte, alors il voit le nombre de cas valides et la confiance du profil, et peut ouvrir la source de chaque événement compté.
6. (VUE-06) Étant donné une installation qui ne comporte que le lot 1, quand l'utilisateur ajoute un joueur, valide un type, déclenche une demande de backtest et colle un résultat de recherche valide, alors il obtient un profil de sensibilité calculé, sans collecte quotidienne ni Telegram.
7. (VUE-07) Étant donné une demande de backtest à faire, quand l'utilisateur ne fait rien, alors aucune recherche approfondie n'est lancée et la demande reste à faire.
8. (VUE-08) Étant donné l'affichage de l'état d'un joueur, d'un type, d'un événement détecté, d'une demande ou d'un cas, quand l'utilisateur le lit, alors le libellé est l'un des états communs de ce document.
9. (VUE-09) Étant donné la page « Méthode et limites », quand l'utilisateur l'ouvre, alors il y lit l'hypothèse conditionnelle, les cinq limites connues et le compteur des événements retirés.
10. (VUE-10) Étant donné le lot 2 livré et un joueur profilé, quand un article rapportant un événement d'un type validé qui le concerne est collecté, alors l'application enregistre l'événement détecté, envoie la fiche d'alerte sur Telegram puis, une fois le match mesuré joué, ajoute le cas suivi au profil et au tableau de validation.

## Hypothèses et questions ouvertes

Toutes les hypothèses H-01 à H-13 du journal restent à confirmer, et les questions Q-01 à Q-07 restent ouvertes. Celles qui pèsent le plus sur cette vue d'ensemble sont H-12 (découpage en lots), Q-03 (liste initiale non désignée), Q-04 (seuils du verdict) et Q-05 (pari).

- **H-VUE-01 — Page « Méthode et limites » (à confirmer).** L'application expose elle-même l'hypothèse et ses limites, pour que l'utilisateur les ait sous les yeux quand il lit un verdict. Aucune décision ne la demande : elle découle de l'exigence d'honnêteté sur les limites de l'hypothèse.
- **H-VUE-02 — Joueur profilé (à confirmer).** Le journal parle d'un joueur « déjà profilé » (D-29) et d'un joueur qui n'a « pas encore de backtest » (D-24) sans définir le seuil qui les sépare. Un seul résultat de recherche importé suffit, même vide ou sans cas valide : le joueur a alors été cherché, et la couverture (05) dit pour quels types. Les documents 04, 05 et 09 emploient cette définition ; le document 05 dit aussi d'un tel joueur qu'il est « déjà traité ».
- **Q-VUE-01 — Profils nombreux et hasard.** Avec 20 à 30 joueurs et plusieurs types, des verdicts « probable » apparaîtront par le seul effet du hasard. Réponse par défaut du document 08, à confirmer : un seuil plus exigeant pour « probable » que pour « possible » (SEN-23) et, à côté de la liste des profils, le nombre de verdicts que le hasard seul produirait, sans corriger les verdicts eux-mêmes (SEN-41, H-SEN-14) ; le profil peut aussi être lu sur les seuls cas historiques ou les seuls cas suivis (SEN-21). Reste ouvert : faut-il que les seuils du verdict (Q-04) tiennent compte du nombre de couples évalués ? En attendant, seul le tableau de validation (10) distingue un effet d'une coïncidence.
