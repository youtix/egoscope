# Journal des décisions — Egoscope

Ce document trace tout ce qui a été décidé pendant le cadrage du projet (six cycles de questions, puis une mise à l'épreuve de l'idée). Il fait foi : en cas de contradiction avec une spécification, c'est lui qui a raison, et la spécification doit être corrigée.

Trois familles d'entrées, à ne jamais confondre :

- **D-xx — Décision** : choix explicite de l'utilisateur.
- **H-xx — Hypothèse de rédaction** : valeur par défaut retenue faute de décision, pour que les spécifications soient complètes. Chaque hypothèse reste à confirmer et doit être présentée comme telle.
- **Q-xx — Question ouverte** : point non tranché, sans valeur par défaut satisfaisante.

## Idée d'origine

Une application qui cherche sur le web les événements susceptibles de toucher l'égo d'un athlète (humiliation, racisme subi, anniversaire, approche d'un record historique, mort d'un proche, conflit entre joueurs, tourmente médiatique, etc.), en partant de l'idée qu'un athlète piqué dans son égo joue mieux au match suivant, ce qui augmenterait les chances de gagner un pari sportif sur lui.

Au fil du cadrage, l'idée a été recentrée : l'application est d'abord un **détecteur de sensibilité par joueur**. Le pari n'est plus un objectif de la première version (voir D-08).

## Décisions de l'utilisateur

### Cycle 1 — Fondations

- **D-01 — Validation par l'historique.** L'hypothèse « événement touchant l'égo → meilleure performance » n'est pas tenue pour acquise : elle se vérifie en confrontant des événements passés aux statistiques réelles (backtest).
- **D-02 — Outil personnel.** Un seul utilisateur. Aucune diffusion ni commercialisation prévue.
- **D-03 — NBA.** Un seul sport au départ : le basket NBA (confirmé en D-33).
- **D-04 — Performance individuelle.** L'objet d'étude est la performance individuelle du joueur, pas le résultat du match.
- **D-05 — Résultat chiffré et sourcé.** L'application restitue un score d'impact accompagné de ses sources, pas de simples alertes brutes ni une recommandation de pari.

### Cycle 2 — Méthode

- **D-06 — Types d'événements nets, découverts avec l'aide d'une IA.** Les types doivent être nets et datables. Une IA explore le web pour proposer des types nets, y compris des types dont les données sont plus difficiles à obtenir.
- **D-07 — Référence : la moyenne de saison du joueur.** La performance d'un match se compare à la moyenne de saison du joueur, pas à la ligne d'un bookmaker.
- **D-07 bis — Gratuité totale.** Toute l'application doit être gratuite : récupération des informations, technologies, hébergement, services.
- **D-08 — Objectif recentré.** But : détecter si un joueur est sensible à un événement, c'est-à-dire établir une relation « événement → hausse du résultat moyen du joueur ». Pas de pari à ce stade.
- **D-09 — Backtest par recherche approfondie manuelle.** Quand un événement est détecté pour un joueur, l'application fournit un prompt imposant un format de retour précis sur le backtest à effectuer. L'utilisateur exécute lui-même ce prompt en recherche approfondie dans une IA, puis rapporte le résultat à l'application.
- **D-10 — Sources : presse sportive et archives d'actualités.** Sources datées et vérifiables, afin de garantir que l'événement était connu avant le match.

### Cycle 3 — Mesure et échanges

- **D-11 — Deux niveaux d'analyse.** Une tendance générale par type d'événement, affinée par joueur dès que ce joueur a assez de cas, avec un niveau de confiance affiché.
- **D-12 — L'IA propose, l'utilisateur valide.** Tout nouveau type d'événement doit être validé par l'utilisateur. Chaque type validé possède une fiche : définition, critères d'inclusion, critères d'exclusion, exemple.
- **D-13 — Indicateur global par minute.** La performance se mesure par un indicateur global rapporté aux minutes jouées, de type Game Score, calculable depuis la feuille de match.
- **D-14 — Format de retour : JSON strict.** Le résultat de la recherche approfondie revient en JSON strict.
- **D-15 — Balayage planifié quotidien.** La détection des nouveaux événements tourne automatiquement chaque jour.

### Cycle 4 — Règles et garde-fous

- **D-16 — Verdict relatif à la variabilité du joueur.** L'écart de performance est rapporté à la variabilité habituelle du joueur (écart-type de saison). Trois niveaux de verdict : probable, possible, non concluant.
- **D-17 — Liste restreinte.** Le balayage porte sur une liste de 20 à 30 joueurs très médiatisés.
- **D-18 — Une vraie application avec base de données.** L'objectif est une application ; les données vivent dans une base de données.
- **D-19 — Facteurs parasites.** Des champs de contexte (retour de blessure, niveau de l'adversaire, enjeu du match, temps de jeu) permettent d'exclure les cas douteux des calculs.
- **D-20 — Données sensibles.** Presse publique uniquement et stockage minimal : type d'événement, date, lien vers la source. Pas de détail intime.

### Cycle 5 — Application

- **D-21 — Destinataire de la documentation.** Les spécifications sont destinées à un agent de développement qui construira l'application.
- **D-22 — Application minimale d'abord.** On construit d'abord une application minimale (base, import du JSON, profils) et la validation de l'hypothèse se fait dedans.
- **D-23 — Base relationnelle hébergée à palier gratuit.**
- **D-24 — Application en deux parties.** Première partie : une recherche quotidienne, menée par une IA gratuite, détecte si un joueur peut être touché par un événement d'égo. Seconde partie : si un événement est détecté et qu'il n'existe pas encore de backtest pour ce joueur, l'application demande une recherche approfondie ; l'utilisateur l'effectue manuellement dans une IA, colle le résultat, et l'application le stocke.
- **D-25 — Application web installable.** Application web adaptée au mobile, de type PWA, installable sur le téléphone de l'utilisateur.

### Cycle 6 — Fonctionnement

- **D-26 — Détection par flux puis classification.** Des flux d'actualités sont collectés par une tâche planifiée, puis classés par un modèle de langage à palier gratuit.
- **D-27 — Statistiques récupérées par l'application.** L'application récupère elle-même les statistiques auprès d'une source gratuite. La recherche approfondie ne fournit que les événements (date, type, lien) ; elle ne fournit aucune statistique.
- **D-28 — Un seul langage.** Pile technique unifiée sur un langage répandu : JavaScript ou TypeScript, côté serveur comme côté interface.
- **D-29 — Fiche d'alerte complète et suivi automatique.** Quand un joueur déjà profilé vit un nouvel événement, l'application produit une fiche complète (événement et source, sensibilité à ce type avec écart moyen, nombre de cas et confiance, prochain match), puis suit automatiquement le résultat du match : chaque nouveau cas enrichit le profil et teste l'hypothèse en conditions réelles.
- **D-30 — Telegram.** Les notifications sont envoyées sur Telegram.

### Mise à l'épreuve

- **D-31 — Hypothèse conditionnelle.** L'effet n'est attendu que chez certains joueurs : il faut à la fois du talent et un égo sensible, c'est-à-dire un joueur que la critique touche. Le backtest sert précisément à repérer ces joueurs. Raisonnement de l'utilisateur : un joueur touché dans son égo prépare son match plus sérieusement et est plus motivé.
- **D-32 — Convictions fondées sur des exemples.** L'utilisateur s'appuie sur des exemples marquants (un attaquant répondant aux critiques racistes par des doublés, une équipe humiliée qui gagne largement le match suivant, une star évitant un 4-0 historique en série), pas sur des données chiffrées. Conséquence méthodologique : voir H-01.
- **D-33 — NBA confirmée.** Malgré des exemples venus du football, le périmètre reste la NBA.
- **D-34 — Nouveau type candidat : le record négatif à éviter.** Exemple donné : une équipe menée 3-0 dans une série, dont la star se surpasse pour éviter le 4-0.
- **D-35 — Pas de critère d'arrêt.** L'utilisateur ne fixe aucun seuil qui lui ferait abandonner le projet. Il a été convenu que l'application afficherait tout de même un tableau de validation honnête (profils confirmés ou démentis par les nouveaux cas), sans arrêt automatique.
- **D-36 — Backtests au fil des détections.** Pas de lot initial couvrant toute la liste : un backtest n'est demandé que lorsqu'un joueur est détecté. Risque accepté : le match peut être joué avant que le backtest soit prêt.

## Types d'événements candidats

Aucun type n'est validé à ce stade : tous doivent recevoir une fiche et être validés par l'utilisateur (D-12).

- Humiliation publique (par un adversaire, un média, un entraîneur).
- Racisme subi.
- Anniversaire du joueur.
- Approche d'un record historique positif.
- Record négatif à éviter (D-34).
- Mort d'un proche.
- Conflit entre joueurs.
- Tourmente médiatique.
- Match contre l'ancienne équipe (proposé pendant le cadrage, non repris explicitement par l'utilisateur).

## Hypothèses de rédaction

- **H-01 — Comptage exhaustif.** Tous les événements d'un joueur comptent, y compris ceux suivis d'une contre-performance. Un backtest qui ne rapporterait que les « belles histoires » est invalide. Annoncé à l'utilisateur pendant la mise à l'épreuve, non contesté.
- **H-02 — Match mesuré.** L'effet se mesure sur le premier match joué par le joueur après que l'événement est devenu public. Un événement publié après le coup d'envoi ne compte pas pour ce match.
- **H-03 — Seuil de cas par joueur.** Un verdict par joueur et par type exige au moins 5 cas valides ; en dessous, seule la tendance générale du type s'applique. La valeur 5 n'a été citée qu'à titre d'exemple : elle doit être un paramètre.
- **H-04 — Effet mesuré dans les deux sens.** Le calcul étant symétrique, une sensibilité négative (le joueur joue moins bien) est mesurée et affichée au même titre qu'une sensibilité positive.
- **H-05 — Un backtest par joueur.** Un backtest couvre un joueur pour tous les types validés à la date de la demande. Quand un type est validé plus tard, une demande complémentaire peut être émise pour les joueurs déjà traités.
- **H-06 — Profondeur historique.** Le backtest porte sur toute la carrière NBA du joueur.
- **H-07 — Événement suivi même sans backtest.** Un événement détecté pour un joueur sans backtest est tout de même enregistré et son match suivi : il devient un cas réel du profil à venir. La demande de backtest affiche l'échéance du prochain match.
- **H-08 — Événements écartables.** L'utilisateur peut écarter un événement détecté à tort ; il n'a pas à valider chaque événement avant qu'une alerte parte.
- **H-09 — Contexte : partage des rôles.** Le temps de jeu et le niveau de l'adversaire sont calculés par l'application à partir des statistiques. Le retour de blessure et l'enjeu du match peuvent être signalés par la recherche approfondie ou par la classification, puis corrigés par l'utilisateur.
- **H-10 — Un seul compte.** L'application est protégée par une authentification minimale, pour un utilisateur unique.
- **H-11 — Langues.** Interface en français. La presse NBA étant surtout anglophone, la collecte et la classification doivent traiter l'anglais et le français.
- **H-12 — Deux lots.** Lot 1, l'application minimale (D-22) : joueurs suivis, taxonomie, demande de backtest déclenchée à la main, prompt, import du JSON, statistiques, calcul de sensibilité, consultation des profils. Lot 2 : collecte et détection quotidiennes, fiche d'alerte, suivi automatique, tableau de validation, Telegram.
- **H-13 — Formule de l'indicateur.** Game Score = points + 0,4 × tirs réussis − 0,7 × tirs tentés − 0,4 × (lancers francs tentés − lancers francs réussis) + 0,7 × rebonds offensifs + 0,3 × rebonds défensifs + interceptions + 0,7 × passes décisives + 0,7 × contres − 0,4 × fautes personnelles − balles perdues. L'indice de performance est ce score divisé par les minutes jouées.

## Questions ouvertes

- **Q-01 — Niveau en développement de l'utilisateur.** Non précisé. Par prudence, tout ce qui touche au déploiement et à l'exploitation doit être décrit de façon très explicite.
- **Q-02 — Services précis.** Hébergeur, base de données, modèle de langage gratuit, source de statistiques et flux d'actualités ne sont pas choisis. Les conditions des paliers gratuits évoluent : elles sont à vérifier au moment de la conception technique. Les spécifications fonctionnelles ne nomment donc aucun fournisseur, à l'exception de Telegram (D-30).
- **Q-03 — Liste initiale des joueurs.** Les 20 à 30 joueurs ne sont pas désignés.
- **Q-04 — Seuils du verdict.** Les valeurs qui séparent « probable », « possible » et « non concluant » ne sont pas fixées.
- **Q-05 — Pari.** Hors périmètre de la première version. Une hausse par rapport à la moyenne de saison ne prouve pas qu'un pari serait rentable ; la comparaison aux lignes des bookmakers reste à étudier plus tard.
- **Q-06 — Événements d'équipe.** Un événement touchant toute une équipe (exemple donné : une élimination humiliante) est hors périmètre de la première version.
- **Q-07 — Autres sports.** Hors périmètre de la première version, sans fermer la porte.

## Limites connues, assumées par l'utilisateur

- L'hypothèse n'est pas démontrée : elle repose aujourd'hui sur des exemples mémorables, donc biaisés (D-32).
- Les échantillons par joueur seront petits : un joueur vit peu d'événements de chaque type dans une carrière.
- Aucun critère d'arrêt n'est fixé (D-35).
- La première alerte d'un joueur arrivera souvent trop tard pour être exploitée (D-36).
- Un contexte de fort enjeu (match éliminatoire) pousse tous les joueurs à se surpasser et peut imiter un effet d'égo (D-19).
