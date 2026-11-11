# 07 — Statistiques de match

## Objet

L'application obtient elle-même, auprès d'une source gratuite, toutes les données de match dont dépend la mesure : calendrier, résultats et feuilles de match des joueurs suivis (D-27). Ce document fixe ce qui est récupéré, comment se calcule l'indice de performance (H-13), comment se construit la référence de saison à laquelle chaque match mesuré est comparé (D-07, D-16) et comment se détermine le prochain match d'un joueur. Il dit aussi ce que fait l'application quand une donnée manque, est corrigée après coup, ou quand la source est indisponible ou son quota atteint. L'usage de ces données pour mesurer une sensibilité relève de [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md).

## Décisions d'origine

- D-04 — L'objet d'étude est la performance individuelle du joueur, pas le résultat du match.
- D-07 — La performance d'un match se compare à la moyenne de saison du joueur, pas à une ligne de bookmaker.
- D-07 bis — Tout est gratuit, y compris la source de statistiques.
- D-13 — La performance se mesure par un indicateur global rapporté aux minutes jouées, de type Game Score, calculable depuis la feuille de match.
- D-16 — L'écart de performance est rapporté à la variabilité habituelle du joueur (écart-type de saison).
- D-18 — Les données vivent dans une base de données.
- D-27 — L'application récupère elle-même les statistiques ; la recherche approfondie n'en fournit aucune.
- D-29 — La fiche d'alerte indique le prochain match, puis l'application suit automatiquement le résultat de ce match.
- D-36 — Le match peut être joué avant que le backtest soit prêt.
- H-02 — Le match mesuré est le premier match joué après que l'événement est devenu public : il faut des horaires de match fiables.
- H-06 — Le backtest porte sur toute la carrière NBA : les statistiques doivent couvrir la même profondeur.
- H-07 — La demande de backtest affiche l'échéance du prochain match.
- H-09 — Le temps de jeu et le niveau de l'adversaire sont calculés par l'application à partir des statistiques.
- H-12 — Découpage en lot 1 (application minimale) et lot 2.
- H-13 — Formule du Game Score ; l'indice de performance est ce score divisé par les minutes jouées.

## Périmètre

Ce document couvre :

- les besoins auxquels doit répondre la source de statistiques et la correspondance statistique d'un joueur suivi dans cette source ;
- le calendrier et les résultats des matchs officiels, le bilan des équipes et l'état des séries de phases finales ;
- la feuille de match d'un joueur et ses contrôles de cohérence ;
- le calcul du Game Score et de l'indice de performance ;
- la distinction entre match non joué, match joué non exploitable et match exploitable ;
- la référence de saison, pour une saison passée comme pour la saison en cours, en saison régulière comme en phases finales ;
- le prochain match d'un joueur suivi, la date de son premier match NBA et les indicateurs de matchs joués et manqués qu'affiche sa fiche ;
- la définition des saisons ;
- les horaires exprimés en instants absolus ;
- les données manquantes, incomplètes, incohérentes ou corrigées après coup, y compris pour les saisons anciennes ;
- l'indisponibilité de la source, les quotas et la mise en mémoire.

Il ne couvre pas :

- le rattachement d'un événement à son match mesuré, l'écart normalisé, les cas douteux et les profils : [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) ;
- le suivi du match qui suit un événement détecté : [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) ;
- l'affichage de l'échéance dans la demande de backtest : [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) ; l'affichage du prochain match dans la fiche d'alerte : [09 — Fiche d'alerte](09-fiche-d-alerte.md) ;
- l'ajout d'un joueur à la liste et sa fiche : [01 — Joueurs suivis](01-joueurs-suivis.md) ;
- le texte des messages d'incident : [11 — Notifications Telegram](11-notifications-telegram.md) ;
- le choix du service, les règles générales de gratuité et de quotas, la planification des tâches, la journalisation et la gestion des paramètres : [14 — Exigences transverses](14-exigences-transverses.md) ;
- les écrans : [12 — Interface et accès](12-interface-et-acces.md).

## Acteurs et déclencheurs

Acteurs :

- l'application, qui interroge la source, contrôle, calcule et met en mémoire ;
- la source de statistiques, service externe gratuit qui n'est pas encore choisi (Q-02) ;
- l'utilisateur, qui confirme la correspondance statistique d'un joueur, peut relancer une récupération et consulte les données.

Déclencheurs :

- l'ajout d'un joueur suivi ([01](01-joueurs-suivis.md)) : identification du joueur dans la source, puis récupération de son historique ;
- l'import d'un résultat de recherche ([06](06-import-des-resultats-de-recherche.md)) : vérification que les saisons concernées par les événements historiques sont disponibles ;
- la mise à jour quotidienne, tâche planifiée dont le mécanisme est décrit dans [14](14-exigences-transverses.md) ;
- une demande d'un autre document : cas en attente ([08](08-sensibilite-et-verdict.md), [10](10-suivi-automatique-et-validation.md)), prochain match ([05](05-demande-de-backtest-et-prompt.md), [09](09-fiche-d-alerte.md), [10](10-suivi-automatique-et-validation.md)) ;
- une relance manuelle par l'utilisateur ;
- le rétablissement de la source ou le renouvellement de son quota.

## Parcours

### Scénario nominal

1. Le joueur A est ajouté à la liste de suivi. L'application recherche son identité dans la source et la fait confirmer par l'utilisateur parmi les candidats trouvés (STA-03, JOU-10).
2. L'application établit la liste des saisons NBA du joueur et, pour chacune, des phases qu'il a disputées.
3. Saison par saison, dans l'ordre de priorité de STA-40, elle récupère le calendrier et les résultats de la saison, puis la feuille de match du joueur pour chaque match officiel de son équipe.
4. Elle contrôle chaque feuille, calcule le Game Score et l'indice de performance de chaque match joué, et classe chaque match en non joué, joué non exploitable ou exploitable.
5. Elle met le tout en mémoire. Une saison terminée depuis plus longtemps que la fenêtre de correction est consolidée et n'est plus jamais redemandée.
6. Quand le document 08 a besoin de la référence du joueur pour une saison, une phase et un match mesuré donnés, l'application la calcule à partir des matchs exploitables en mémoire, match mesuré exclu.
7. Chaque jour, une fois terminés les matchs de la journée de compétition écoulée, l'application met à jour le calendrier de la saison en cours, les résultats et les feuilles des joueurs suivis, redemande les feuilles encore dans la fenêtre de correction, et signale au document 08 les matchs nouveaux ou modifiés.
8. À la demande des documents 05, 09 ou 10, elle fournit le prochain match du joueur.

### Variantes

- Correspondance non confirmée : tant que l'utilisateur n'a pas choisi, aucune statistique du joueur n'est récupérée, ses cas restent en attente et la recherche des candidats est relancée à chaque mise à jour quotidienne (STA-03).
- Source indisponible : la récupération est retentée (STA-36), puis un incident est signalé ; aucun cas ne change d'état du seul fait de la panne.
- Quota atteint : les demandes restantes sont mises en file selon leur priorité et reprennent au renouvellement du quota ; une longue récupération de carrière peut s'étaler sur plusieurs jours.
- Correction après coup : une feuille modifiée par la source dans la fenêtre de correction est remplacée, la modification est tracée et le document 08 recalcule ce qui en dépend.
- Saison ancienne incomplète : les matchs sans feuille complète n'ont pas d'indice ; la référence est calculée sur les matchs restants et porte la mention « partielle » si la proportion de matchs manquants est forte.
- Transfert en cours de saison : l'équipe actuelle du joueur change et son prochain match est recalculé ; la référence de la saison réunit ses matchs dans ses différentes équipes.
- Match reporté : le calendrier est mis à jour et le prochain match recalculé.
- Début de la saison en cours : la référence est « en constitution » tant que le joueur n'a pas assez de matchs exploitables.

## Règles de gestion

### Source et identité des joueurs

- STA-01 [Lot 1] — Toutes les statistiques de match sont obtenues par l'application auprès d'une source gratuite (D-27, D-07 bis). Aucune statistique ne provient du résultat de recherche. Aucune saisie manuelle de statistiques n'est prévue (H-STA-01, à confirmer) : elle ouvrirait la porte aux erreurs et aux arrangements.
- STA-02 [Lot 1] — La source retenue doit permettre, sans intervention humaine : de connaître tous les matchs officiels NBA de saison régulière, du tournoi de qualification et des phases finales, avec leur heure de début et son fuseau, leurs équipes, leur statut, leur score et, hors saison régulière, la série à laquelle ils appartiennent ; d'obtenir pour chaque joueur et chaque match tous les éléments de STA-08 ; de remonter assez loin pour couvrir la carrière NBA des joueurs suivis (H-06) ; d'identifier joueurs, équipes et matchs de façon stable ; de répercuter les corrections officielles ; de connaître ou d'observer son quota. Ces besoins complètent les critères généraux de choix des services décrits dans [14](14-exigences-transverses.md) (Q-02).
- STA-03 [Lot 1] — Chaque joueur suivi est relié à une et une seule identité dans la source : c'est sa correspondance statistique, que l'utilisateur confirme toujours selon le document 01 (JOU-10). À l'ajout du joueur, l'application présente les candidats avec ce qui les distingue (nom, équipes, saisons jouées), homonymes et noms proches compris. Si aucun candidat ne convient, ou si la source est indisponible ou son quota atteint, la recherche est relancée à chaque mise à jour quotidienne et les nouveaux candidats sont présentés dans la liste « à faire » ([12](12-interface-et-acces.md)). Tant que la correspondance n'est pas confirmée, aucune statistique du joueur n'est récupérée. Une correspondance peut être corrigée (JOU-12) ; la correction entraîne une nouvelle récupération et le recalcul de tous les cas du joueur.

### Calendrier, résultats, bilans et séries

- STA-04 [Lot 1] — Seuls comptent les matchs officiels de la NBA (VUE-01) : saison régulière, tournoi de qualification et phases finales. Les matchs d'une autre compétition, par exemple avec une sélection nationale, ne sont jamais retenus. Les matchs de présaison, les matchs d'exhibition, le match des étoiles et tout match que la source ne compte pas dans les statistiques officielles de la saison sont ignorés : ils ne sont jamais un match mesuré et n'entrent dans aucune référence (H-STA-02, à confirmer).
- STA-05 [Lot 1] — Chaque match porte : la saison (par exemple 2024-2025), la phase, l'instant prévu de début, l'équipe qui reçoit et l'équipe qui se déplace, le statut (prévu, en cours, terminé, reporté, annulé), le score final et, pour le tournoi de qualification et les phases finales, la série, le numéro du match dans la série et le nombre de victoires de chaque équipe avant ce match.
- STA-06 [Lot 1] — Le bilan d'une équipe est calculé par l'application à partir des résultats : nombre de victoires et de défaites en saison régulière d'une saison donnée, avec la possibilité d'exclure un match précis. Il sert au critère du niveau de l'adversaire (H-09) défini dans [08](08-sensibilite-et-verdict.md) (SEN-15).
- STA-07 [Lot 1] — Pour chaque match du tournoi de qualification ou des phases finales, l'application indique si une défaite élimine l'une des deux équipes. Cette information sert au critère d'enjeu inhabituel défini dans [08](08-sensibilite-et-verdict.md) (SEN-14).

### Feuille de match d'un joueur

- STA-08 [Lot 1] — Pour chaque match officiel de son équipe, la feuille de match du joueur indique s'il a joué et, s'il a joué : les minutes et secondes passées sur le terrain ; les points ; les tirs réussis et les tirs tentés (tous les tirs du jeu, à deux et à trois points, lancers francs exclus) ; les lancers francs réussis et tentés ; les rebonds offensifs ; les rebonds défensifs ; les passes décisives ; les interceptions ; les contres ; les balles perdues ; les fautes personnelles ; l'équipe pour laquelle il a joué, qui sert de constat au document 01 (JOU-13). Les tirs à trois points réussis sont aussi récupérés quand la source les donne, uniquement pour le contrôle de STA-09.
- STA-09 [Lot 1] — Une feuille est contrôlée avant tout calcul : aucune valeur négative ; réussis inférieurs ou égaux aux tentés, pour les tirs comme pour les lancers francs ; points égaux à deux fois les tirs réussis, plus les tirs à trois points réussis, plus les lancers francs réussis, quand les tirs à trois points sont connus ; minutes comprises entre zéro et la durée du match, prolongations comprises (48 minutes plus 5 par prolongation) ; aucune statistique non nulle pour un joueur sans minutes. Une feuille qui échoue à un contrôle est « douteuse » : elle n'entre dans aucun calcul tant qu'une récupération ultérieure ne l'a pas rendue cohérente, et l'anomalie est tracée.
- STA-10 [Lot 1] — Une feuille à laquelle manquent les minutes ou un élément nécessaire au Game Score est « incomplète ». Aucune valeur manquante n'est jamais remplacée par zéro, par une moyenne ou par une estimation.

### Indice de performance

- STA-11 [Lot 1] — Le Game Score d'un match (H-13) est égal aux points, plus 0,4 fois les tirs réussis, moins 0,7 fois les tirs tentés, moins 0,4 fois la différence entre lancers francs tentés et lancers francs réussis, plus 0,7 fois les rebonds offensifs, plus 0,3 fois les rebonds défensifs, plus les interceptions, plus 0,7 fois les passes décisives, plus 0,7 fois les contres, moins 0,4 fois les fautes personnelles, moins les balles perdues.
- STA-12 [Lot 1] — L'indice de performance d'un match est égal au Game Score de ce match divisé par les minutes jouées, exprimées en minutes décimales (34 minutes et 30 secondes valent 34,5). Il n'est calculé que pour un match joué dont la feuille est complète et cohérente. Les calculs se font sans arrondi ; l'affichage arrondit l'indice à trois décimales. Un indice négatif est valable et conservé tel quel. Si la source ne donne que des minutes entières, l'indice est calculé sur ces minutes et la feuille porte la mention « minutes arrondies ».

### Matchs non joués et faible temps de jeu

- STA-13 [Lot 1] — Un match est « joué » si le joueur a passé un temps strictement positif sur le terrain. Sinon il est « non joué », quelle qu'en soit la raison, sans que la cause de l'absence (blessure, suspension, choix de l'entraîneur, raison personnelle) soit jamais enregistrée (JOU-21, DSN-15). Un match non joué n'a pas d'indice, n'entre dans aucune référence et compte comme une absence pour le critère de retour de blessure défini dans [08](08-sensibilite-et-verdict.md) (SEN-13).
- STA-14 [Lot 1] — Un match joué est « exploitable » si sa feuille est complète et cohérente et si le joueur a joué au moins le seuil de temps de jeu. Ce seuil est la plus grande des deux valeurs suivantes : un plancher de 15 minutes (paramétrable) ; 50 % (paramétrable) de la moyenne de minutes du joueur par match joué en saison régulière de la même saison (H-STA-03, à confirmer). Exemple : pour un joueur qui joue en moyenne 35 minutes, le seuil est de 17,5 minutes ; pour un joueur à 24 minutes de moyenne, il est de 15 minutes.
- STA-15 [Lot 1] — Le même seuil s'applique aux matchs de la référence et au match mesuré : le document 08 l'utilise tel quel pour son critère de temps de jeu trop faible (SEN-12). Comparer un match mesuré à une référence qui contiendrait des matchs que l'on aurait écartés comme matchs mesurés fausserait la comparaison, par exemple si des sorties sur blessure en début de match tiraient la moyenne vers le bas.

### Référence de saison

- STA-16 [Lot 1] — La référence de saison d'un joueur se calcule pour une saison, une phase et un match mesuré donnés. Elle porte sur les indices de ses matchs exploitables de cette saison et de cette phase, match mesuré exclu. La moyenne est la somme de ces indices divisée par leur nombre. L'écart-type est la racine carrée de la somme des carrés des différences entre chaque indice et cette moyenne, divisée par le nombre d'indices moins un (H-STA-04, à confirmer). La référence indique aussi le nombre de matchs retenus, son état (définitive, provisoire, en constitution ou insuffisante) et, le cas échéant, la mention « partielle » (STA-24).
- STA-17 [Lot 1] — Le match mesuré est toujours retiré de sa propre référence : le laisser reviendrait à comparer le match en partie à lui-même et atténuerait artificiellement les écarts les plus marqués, surtout quand la référence compte peu de matchs. Seul ce match est retiré ; les autres matchs de la saison, y compris ceux qui sont les matchs mesurés d'autres cas, restent dans la référence (H-STA-05, à confirmer). Ce choix est prudent : si les événements améliorent vraiment les performances, il rend l'effet un peu plus difficile à détecter, jamais plus facile.
- STA-18 [Lot 1] — Un match de saison régulière est comparé à la saison régulière de la même saison. Un match du tournoi de qualification ou des phases finales est comparé à l'ensemble des matchs exploitables du tournoi de qualification et des phases finales de la même saison (H-STA-06, à confirmer) : l'intensité et les adversaires y sont différents, et un mélange avec la saison régulière introduirait un décalage du même ordre que les effets recherchés. Un paramètre permet de comparer plutôt ces matchs à la saison régulière de la même saison (valeur par défaut : phases finales) ; ce réglage augmente le nombre de cas mesurables au prix de ce décalage.
- STA-19 [Lot 1] — Une référence exige au moins 10 matchs exploitables, match mesuré exclu (paramétrable, H-STA-07, à confirmer). Si la phase est terminée et que ce minimum n'est pas atteint, ou si l'écart-type est nul, la référence est « insuffisante » et le document 08 classe le cas non mesurable.
- STA-20 [Lot 1] — Pour une phase terminée, la référence porte sur tous les matchs exploitables de la phase, avant comme après le match mesuré. Elle reste provisoire jusqu'à ce que la fenêtre de correction de STA-33 soit écoulée pour le dernier match de la phase, puis devient « définitive ». Pour le tournoi de qualification et les phases finales, la phase est terminée pour un joueur quand son équipe est éliminée ou que la finale est jouée.
- STA-21 [Lot 1] — Pour la saison en cours, tant que la phase n'est pas terminée, la référence porte sur les matchs exploitables déjà joués, avant comme après le match mesuré, match mesuré exclu. Elle est « provisoire » : elle est recalculée après chaque nouveau match du joueur, et les écarts qui en dépendent changent avec elle jusqu'à ce qu'elle devienne définitive (H-STA-08, à confirmer). Ainsi, une fois la saison finie, un cas de la saison en cours est mesuré exactement comme un cas d'une saison passée.
- STA-22 [Lot 1] — En début de phase, tant que la référence compte moins de matchs que le minimum de STA-19, elle est « en constitution » : le cas reste en attente et sera mesuré dès que le minimum est atteint. Si la phase se termine sans l'atteindre, la référence devient insuffisante.
- STA-23 [Lot 2] — Tant qu'une référence est en constitution, l'application calcule une comparaison indicative avec la référence définitive de la saison régulière précédente du joueur, quand elle existe. Cette comparaison est toujours présentée comme « indicative », n'est jamais enregistrée comme écart normalisé d'un cas et n'entre dans aucun calcul (H-STA-09, à confirmer). Elle sert au résultat communiqué après un match suivi ([10](10-suivi-automatique-et-validation.md)).
- STA-24 [Lot 1] — Si plus de 20 % (paramétrable) des matchs joués d'une saison et d'une phase n'ont pas d'indice parce que leur feuille est incomplète ou douteuse, la référence porte la mention « partielle » (H-STA-10, à confirmer). Elle reste utilisable si elle atteint le minimum de STA-19, et la mention suit les cas qui l'utilisent pour être affichée par le document 08.

### Prochain match d'un joueur suivi

- STA-25 [Lot 1] — L'équipe actuelle d'un joueur suivi est tenue par le document 01 (JOU-13, H-JOU-03) : l'application la met à jour d'après l'équipe de son dernier match joué (STA-08) ou d'après un changement d'équipe plus récent que la source indique (transfert, signature, libération) ; l'utilisateur peut aussi la changer à la main. Elle est vérifiée à chaque mise à jour quotidienne.
- STA-26 [Lot 1] — Le prochain match d'un joueur suivi est le prochain match officiel de son équipe actuelle dont l'instant prévu de début est postérieur au moment présent et dont le statut est « prévu ». L'application fournit son instant de début, l'adversaire, le lieu (à domicile ou à l'extérieur), la phase, ainsi que la date du dernier match joué par le joueur. S'il n'y en a pas, elle répond « aucun match prévu » avec le motif : intersaison, équipe éliminée, joueur sans équipe ou calendrier non publié.
- STA-27 [Lot 1] — Le prochain match est celui de l'équipe : rien ne garantit que le joueur y participera. Le match mesuré d'un événement est le premier match que le joueur joue réellement, selon la règle de [08](08-sensibilite-et-verdict.md) (SEN-03). Pour ce rattachement, l'application fournit la liste chronologique des matchs officiels des équipes du joueur à partir d'un instant donné, avec pour chacun sa participation et ses minutes.
- STA-28 [Lot 1] — Le prochain match est recalculé après chaque match et à chaque modification du calendrier (report, changement d'horaire, transfert). Les documents 05, 09 et 10 lisent toujours la valeur à jour et n'en gardent pas de copie, sauf dans leur propre historique.

### Horaires

- STA-29 [Lot 1] — Tous les horaires sont enregistrés en instants absolus, c'est-à-dire en moments uniques dans le monde, indépendants des fuseaux horaires et des changements d'heure. L'heure fournie par la source est convertie avec son fuseau. Si la source donne une heure sans fuseau, la règle de conversion est établie une fois pour toutes au choix de la source et vérifiée sur des matchs dont l'horaire est connu ; les règles générales sur les instants sont celles du document 14 (TRV-68 à TRV-73).
- STA-30 [Lot 1] — Les horaires sont affichés dans le fuseau horaire de l'utilisateur, réglage que possède le document 12 avec sa valeur par défaut (IHM-14). Toute comparaison entre un événement et un match (H-02) se fait entre instants absolus, jamais entre heures locales.
- STA-31 [Lot 1] — Un match dont l'heure n'est pas encore fixée est enregistré avec sa date et la mention « heure à déterminer ». Tant que l'heure est inconnue, il est réputé commencer au début de sa journée, à l'heure locale du lieu du match (H-STA-11, à confirmer). L'instant est mis à jour dès que l'heure est publiée ; c'est toujours la dernière heure prévue connue qui fait foi.

### Mise à jour quotidienne

- STA-32 [Lot 1] — Une fois par jour, au plus tôt 3 heures (paramétrable) après le coup d'envoi prévu du dernier match de la journée de compétition écoulée (H-STA-12, à confirmer), l'application récupère les résultats de cette journée, les feuilles des joueurs suivis, le calendrier à jour de la saison en cours et les feuilles encore dans la fenêtre de correction. Elle signale ensuite au document 08 la liste des matchs nouveaux ou modifiés. La planification elle-même relève de [14](14-exigences-transverses.md).

### Données manquantes et corrections

- STA-33 [Lot 1] — Pendant une fenêtre de correction de 7 jours après un match (paramétrable), l'application redemande à chaque mise à jour quotidienne les feuilles des joueurs suivis pour ce match. Toute différence remplace l'ancienne valeur, est tracée (élément, ancienne valeur, nouvelle valeur, date) et déclenche le recalcul des indices, des références et des cas qui en dépendent ([08](08-sensibilite-et-verdict.md)). Après la fenêtre, le match est « consolidé » (H-STA-13, à confirmer).
- STA-34 [Lot 1] — Une correction découverte après la fenêtre, lors d'une relance manuelle (STA-44), est traitée et tracée de la même façon.
- STA-35 [Lot 1] — Si la source répond normalement mais ne fournit pas la feuille d'un match terminé, l'application la redemande à chaque mise à jour quotidienne. Au-delà de 30 jours après le match (paramétrable, H-STA-13, à confirmer), la feuille est « indisponible » et le document 08 classe le cas concerné non mesurable ; une relance manuelle reste possible et peut rendre le cas de nouveau mesurable. Les jours où la source est en panne ne comptent pas dans ce délai.

### Disponibilité de la source et quotas

- STA-36 [Lot 1] — Quand la source ne répond pas ou répond en erreur, l'application retente après 1 heure, puis toutes les 4 heures (paramétrables, H-STA-14, à confirmer). Aucun cas ne change d'état du seul fait de la panne : les cas concernés restent en attente avec le motif « statistiques en attente ».
- STA-37 [Lot 1] — Après 12 heures d'échecs continus (paramétrable, H-STA-14, à confirmer), un incident « source de statistiques indisponible » est ouvert et affiché dans l'interface ([12](12-interface-et-acces.md)). Il se ferme automatiquement quand la source répond de nouveau.
- STA-38 [Lot 2] — Les incidents de STA-37 et STA-39 sont aussi notifiés sur Telegram, selon le catalogue de [11](11-notifications-telegram.md).
- STA-39 [Lot 1] — L'application compte ses demandes à la source par rapport au quota connu ou observé. Elle s'arrête avant de l'atteindre en gardant une réserve de 10 % (paramétrable) pour les demandes des niveaux 1 et 2 de STA-40, met les autres demandes en file et reprend au renouvellement du quota ; un incident « quota atteint » est alors ouvert, et fermé à la reprise. Elle ne passe jamais à une offre payante et ne cherche pas à contourner le quota (D-07 bis, H-STA-15, à confirmer).
- STA-40 [Lot 1] — Quand toutes les demandes ne peuvent pas être servies, elles le sont dans cet ordre (H-STA-15, à confirmer) : 1) les feuilles des matchs déjà joués qui mesurent un cas suivi en attente (les cas suivis n'existent qu'au lot 2) ; 2) le calendrier de la saison en cours et le prochain match des joueurs suivis ; 3) les résultats et feuilles de la journée écoulée et les corrections dans la fenêtre ; 4) les saisons où tombe le match mesuré d'un cas historique en attente, de la plus récente à la plus ancienne ; 5) le reste de la carrière des joueurs suivis.
- STA-41 [Lot 1] — Pour une récupération longue, par exemple une carrière entière, l'application affiche l'avancement (« 9 saisons sur 14 ») et une date estimée de fin compte tenu du quota. Les cas qui attendent ces données affichent le motif « statistiques en attente ».

### Mise en mémoire

- STA-42 [Lot 1] — Tout ce qui est récupéré est conservé dans la base (D-18) avec sa date de récupération : calendriers, résultats, feuilles. Une donnée consolidée n'est jamais redemandée. Seuls sont redemandés chaque jour le calendrier de la saison en cours et les feuilles encore dans la fenêtre de correction. Les données communes à plusieurs joueurs, comme le calendrier et les résultats d'une saison, ne sont récupérées qu'une fois.
- STA-43 [Lot 1] — Les indices, références, bilans d'équipe et prochains matchs sont recalculés à partir des données en mémoire, sans nouvelle demande à la source, y compris lors d'un recalcul complet demandé par le document 08.
- STA-44 [Lot 1] — L'utilisateur peut forcer la récupération d'un match, d'une saison ou de tout l'historique d'un joueur. Cette relance consomme du quota, suit l'ordre de STA-40, et toute différence avec les données en mémoire est traitée selon STA-34.

### Données anciennes

- STA-45 [Lot 1] — Les saisons anciennes suivent les mêmes règles : feuille incomplète sans indice (STA-10), minutes arrondies (STA-12), référence partielle (STA-24). Si la source ne couvre pas du tout une saison, les cas dont le match mesuré y tombe sont classés non mesurables par le document 08, motif « saison non couverte par la source », et le profil le montre (H-STA-16, à confirmer ; voir Q-STA-01).

### Données fournies aux autres documents

- STA-46 [Lot 1] — Pour chaque joueur suivi dont la correspondance est confirmée, l'application fournit au document 01, à partir des feuilles de match : le nombre de matchs joués et le temps de jeu moyen par match joué de la saison en cours (JOU-02) ; la date de son dernier match joué et le nombre de matchs consécutifs de son équipe qu'il a manqués depuis (JOU-21, JOU-22), sans jamais en enregistrer la cause. Ces indicateurs sont recalculés à chaque mise à jour quotidienne, à partir des données en mémoire (STA-43).
- STA-47 [Lot 1] — L'application fournit la date du premier match NBA officiel de chaque joueur suivi (STA-04), telle que la source la donne ou qu'elle se déduit de ses feuilles de match. Elle borne le début de la carrière pour la demande de backtest et pour l'import (BKT-08, H-BKT-01, IMP-12). Si elle n'est pas encore connue, ou si la source ne couvre pas le début de carrière du joueur (STA-45), l'application répond « date inconnue ».
- STA-48 [Lot 1] — Une saison NBA se nomme par ses deux années (par exemple 2024-2025) et va du premier match officiel de sa saison régulière au dernier match de ses phases finales. Pour ranger une date par saison, par exemple dans l'aperçu d'import (IMP-22), une date d'intersaison est rattachée à la saison qui suit (H-STA-17, à confirmer).

## Données manipulées

- Match : saison ; phase (saison régulière, tournoi de qualification, phases finales) ; instant prévu de début, ou date avec la mention « heure à déterminer » ; équipe qui reçoit et équipe qui se déplace ; statut (prévu, en cours, terminé, reporté, annulé) ; score final ; hors saison régulière, la série, le numéro du match, le nombre de victoires de chaque équipe avant le match et l'indication qu'une défaite élimine une équipe ; état de consolidation (dans la fenêtre de correction, consolidé) ; date de dernière récupération.
- Feuille de match d'un joueur : le joueur, le match, son équipe pour ce match ; joué ou non joué, sans cause d'absence ; si joué, les minutes et secondes et les éléments de STA-08 ; état (complète, incomplète, douteuse, indisponible) ; mention « minutes arrondies » le cas échéant ; date de récupération ; historique des corrections.
- Indice de performance : Game Score, minutes décimales, indice, classement du match (non joué, joué non exploitable, exploitable) et seuil de temps de jeu appliqué.
- Référence de saison : joueur, saison, phase, match mesuré exclu, nombre de matchs retenus, moyenne, écart-type, état (définitive, provisoire, en constitution, insuffisante), mention « partielle », date du calcul.
- Bilan d'équipe : équipe, saison, victoires et défaites en saison régulière, match exclu le cas échéant, date du calcul.
- Prochain match : joueur, équipe actuelle, match (instant, adversaire, lieu, phase) ou « aucun match prévu » avec son motif, date du dernier match joué par le joueur.
- Correspondance statistique : joueur suivi, identité dans la source, date de la confirmation par l'utilisateur, ou mention « correspondance à établir » avec les candidats proposés (JOU-10).
- Indicateurs fournis au document 01 : matchs joués et temps de jeu moyen de la saison, date du dernier match joué, matchs consécutifs manqués (STA-46) ; date du premier match NBA (STA-47).
- File de récupération : objet demandé (match, saison, historique d'un joueur), niveau de priorité, nombre de tentatives, prochaine tentative, motif d'attente (panne, quota).
- Incident de source : nature (source indisponible, quota atteint), début, fin, nombre de demandes en attente.
- Journal des corrections : match, joueur, élément, ancienne valeur, nouvelle valeur, date, origine (fenêtre de correction ou relance manuelle).
- Paramètres de ce document, avec leur valeur par défaut : plancher de temps de jeu (15 minutes) ; fraction de la moyenne de minutes (50 %) ; taille minimale d'une référence (10 matchs) ; référence des matchs de phases finales (phases finales) ; seuil de référence partielle (20 %) ; délai de mise à jour quotidienne (3 heures après le dernier coup d'envoi) ; fenêtre de correction (7 jours) ; délai avant feuille indisponible (30 jours) ; délais de nouvelle tentative (1 heure, puis 4 heures) ; délai avant incident (12 heures) ; réserve de quota (10 %).

## Cas limites et erreurs

- Match avec prolongations : la durée maximale admise pour les minutes augmente de 5 minutes par prolongation (STA-09).
- Joueur transféré en cours de saison : sa référence de la saison réunit ses matchs dans ses différentes équipes, car elle porte sur le joueur (D-07) ; sa moyenne de minutes aussi. Les matchs disputés par une équipe avant l'arrivée du joueur ou après son départ ne comptent pas comme des absences.
- Transfert pas encore visible dans la source : le prochain match affiché peut rester celui de l'ancienne équipe ; la date du dernier match joué, affichée avec le prochain match, aide l'utilisateur à s'en apercevoir.
- Match reporté : il garde son identité, passe à l'état « reporté », puis revient à l'état « prévu » avec sa nouvelle date quand elle est connue. Un match annulé est ignoré.
- Match joué hors d'Amérique du Nord, changements d'heure à des dates différentes en Europe et en Amérique du Nord : les instants absolus évitent toute erreur (voir le critère d'acceptation sur le mois de mars).
- Joueur qui joue sans rien inscrire : la feuille est valable et donne un Game Score nul ou négatif ; elle n'est ni écartée ni corrigée.
- Saison sans aucun match exploitable (blessure longue) : toutes les références de la saison sont insuffisantes.
- Phases finales courtes (élimination rapide) : la référence des phases finales est souvent insuffisante avec le réglage par défaut ; le paramètre de STA-18 permet de choisir la saison régulière, en connaissance du décalage que cela introduit.
- Changement d'identifiants par la source : l'application signale les joueurs dont le lien ne fonctionne plus et redemande une confirmation (STA-03).
- Données manifestement fausses pour toute une journée : les contrôles de STA-09 marquent les feuilles douteuses ; une correction ultérieure les rétablit.
- Correction qui modifie un indice après qu'un résultat a été communiqué : le recalcul suit [08](08-sensibilite-et-verdict.md) et l'effet sur le cas suivi est traité par [10](10-suivi-automatique-et-validation.md).
- Match ignoré par STA-04 disputé entre un événement et le match mesuré : il n'est ni un match mesuré ni une absence.
- Événement écarté (04) ou retiré (13) : les statistiques en mémoire ne changent pas, puisqu'elles ne portent aucune donnée d'événement ; seules sortent de la file de récupération (STA-40) les demandes qui ne servaient qu'à son cas.

## Critères d'acceptation

- Étant donné une feuille où le joueur a joué 34 minutes 30 secondes, marqué 31 points, réussi 11 tirs sur 20 et 7 lancers francs sur 8, pris 1 rebond offensif et 6 défensifs, fait 7 passes décisives, 2 interceptions, 1 contre, 4 balles perdues et 3 fautes, quand l'application calcule l'indice, alors le Game Score vaut 25,9 et l'indice affiché vaut 0,751.
- Étant donné un joueur dont les dix matchs exploitables d'une saison terminée, hors match mesuré, ont pour indices 0,42 ; 0,55 ; 0,61 ; 0,48 ; 0,70 ; 0,52 ; 0,66 ; 0,39 ; 0,58 et 0,63, et un match mesuré d'indice 0,80, quand le document 08 demande la référence de ce match, alors elle compte 10 matchs, sa moyenne vaut 0,554 et son écart-type 0,102 (l'écart normalisé qui en découle vaut 2,41), et non 0,576 et 0,122 comme si le match mesuré avait été conservé (l'écart ne vaudrait plus que 1,83).
- Étant donné un joueur qui joue en moyenne 35 minutes en saison régulière, quand il joue 16 minutes dans un match, alors ce match est non exploitable (seuil de 17,5 minutes) et n'entre pas dans sa référence ; étant donné un joueur à 24 minutes de moyenne, quand il joue 16 minutes, alors le match est exploitable (seuil de 15 minutes).
- Étant donné une feuille sans nombre de balles perdues, quand l'application la traite, alors elle est marquée incomplète, aucun indice n'est calculé et aucune valeur n'est remplacée par zéro.
- Étant donné une feuille indiquant 30 points pour 10 tirs réussis, dont 2 à trois points, et 4 lancers francs réussis, quand elle est contrôlée, alors elle est marquée douteuse et n'entre dans aucun calcul.
- Étant donné la saison en cours où le joueur compte 7 matchs exploitables en plus du match mesuré, quand le document 08 demande la référence, alors elle est en constitution ; quand il atteint 10 matchs exploitables hors match mesuré, alors elle devient provisoire et le cas peut être mesuré ; quand la phase est terminée et la fenêtre de correction de son dernier match écoulée, alors elle devient définitive.
- Étant donné un match de phases finales et 12 autres matchs exploitables de phases finales la même saison, quand sa référence est calculée avec le réglage par défaut, alors elle porte sur ces 12 matchs et non sur la saison régulière ; étant donné seulement 6 autres matchs et une équipe éliminée, alors la référence est insuffisante.
- Étant donné un match prévu le 14 mars 2025 à 19 h 30, heure de la côte Est des États-Unis, et un affichage réglé sur le fuseau d'Europe centrale, quand le prochain match est affiché, alors il l'est le 15 mars 2025 à 0 h 30, et non à 1 h 30, car l'Amérique du Nord est déjà passée à l'heure d'été et pas encore l'Europe.
- Étant donné un joueur dont l'équipe ne joue plus avant la saison suivante, quand le document 05 demande son prochain match, alors l'application répond « aucun match prévu » avec le motif « intersaison » ou « équipe éliminée ».
- Étant donné une feuille récupérée après un match, quand la source corrige deux jours plus tard le nombre de rebonds défensifs, alors l'application remplace la valeur, trace l'ancienne et la nouvelle, recalcule l'indice et signale le match au document 08.
- Étant donné un match consolidé, quand la mise à jour quotidienne s'exécute, alors aucune demande n'est adressée à la source pour ce match.
- Étant donné une source qui ne répond plus, quand 12 heures d'échecs continus se sont écoulées, alors un incident est ouvert et affiché, les cas concernés restent en attente avec le motif « statistiques en attente » et aucun ne devient non mesurable ; quand la source répond de nouveau, alors les demandes en file reprennent dans l'ordre de STA-40 et l'incident se ferme.
- Étant donné une récupération de carrière en cours et un quota dont il ne reste que la réserve, quand une nouvelle demande de carrière se présente, alors elle est mise en file, la réserve reste disponible pour le calendrier et les cas en attente, l'avancement est affiché et la récupération reprend au renouvellement du quota.
- Étant donné un match terminé pour lequel la source répond sans fournir la feuille, quand 30 jours se sont écoulés, alors la feuille est indisponible et le cas est classé non mesurable par le document 08 ; quand l'utilisateur relance la récupération et que la feuille est fournie, alors le cas redevient mesurable.
- Étant donné deux joueurs portant le même nom dans la source, quand l'utilisateur ajoute l'un d'eux à la liste de suivi, alors l'application lui demande de choisir et ne récupère aucune statistique tant qu'il ne l'a pas fait ; étant donné une source indisponible à l'ajout, alors la recherche des candidats reprend à la mise à jour quotidienne suivante.
- Étant donné un joueur absent de cinq matchs, quand sa fiche est affichée, alors elle indique cinq matchs consécutifs manqués et la date de son dernier match joué, sans aucune cause d'absence.
- Étant donné un événement daté du 12 août 2021, entre la finale de la saison 2020-2021 et le premier match de la saison suivante, quand l'aperçu d'import répartit les événements par saison, alors il le range dans la saison 2021-2022.
- Étant donné une saison consolidée déjà en mémoire, quand un nouveau résultat de recherche portant sur cette saison est importé, alors aucune demande n'est adressée à la source pour cette saison.
- Étant donné une saison ancienne dont 25 % des matchs joués ont une feuille incomplète et qui compte 40 matchs exploitables, quand sa référence est calculée, alors elle est utilisable et porte la mention « partielle ».

## Dépendances

- [00 — Vue d'ensemble](00-vue-d-ensemble.md) : glossaire et objets métier (match mesuré, indice de performance, référence de saison, cas).
- [01 — Joueurs suivis](01-joueurs-suivis.md) : l'ajout d'un joueur déclenche la recherche de sa correspondance statistique (STA-03, JOU-10) ; l'équipe constatée met à jour l'équipe actuelle (JOU-13) ; la fiche joueur affiche les indicateurs de STA-46 (JOU-02, JOU-21).
- [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) : utilise le prochain match pour l'échéance de la demande (H-07, D-36), la date du premier match NBA (STA-47) et les saisons (STA-48).
- [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) : l'import déclenche la récupération des saisons concernées ; le résultat de recherche ne contient aucune statistique (D-27) ; l'aperçu range les événements par saison (STA-48) et borne la carrière par le premier match NBA (STA-47).
- [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) : utilise les feuilles, les indices, le seuil de temps de jeu, les références, les bilans d'équipe, l'état des séries, la participation et les absences ; reçoit la liste des matchs nouveaux ou modifiés.
- [09 — Fiche d'alerte](09-fiche-d-alerte.md) : affiche le prochain match.
- [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) : s'appuie sur la liste chronologique des matchs, sur la mise à jour quotidienne et sur la comparaison indicative.
- [11 — Notifications Telegram](11-notifications-telegram.md) : messages d'incident « source de statistiques indisponible » et « quota atteint ».
- [12 — Interface et accès](12-interface-et-acces.md) : fuseau d'affichage (IHM-14), incidents, avancement des récupérations, relance manuelle, choix de la correspondance statistique d'un joueur.
- [14 — Exigences transverses](14-exigences-transverses.md) : choix de la source (Q-02), règles générales de gratuité et de quotas, planification de la mise à jour quotidienne, journalisation, gestion des paramètres.

## Hypothèses et questions ouvertes

Renvois au journal :

- H-02, H-06, H-07, H-09, H-12 et H-13 sont des hypothèses du journal, à confirmer comme telles ; ce document les applique sans les modifier.
- Q-02 : la source de statistiques n'est pas choisie ; STA-02 décrit seulement ce qu'elle doit permettre.

Hypothèses locales, toutes à confirmer :

- H-STA-01 — Pas de saisie manuelle de statistiques (STA-01).
- H-STA-02 — Seuls comptent la saison régulière, le tournoi de qualification et les phases finales ; tout match non compté dans les statistiques officielles de la saison est ignoré (STA-04).
- H-STA-03 — Seuil de temps de jeu : le plus grand de 15 minutes et de 50 % de la moyenne de minutes en saison régulière, appliqué de la même façon à la référence et au match mesuré (STA-14, STA-15).
- H-STA-04 — Écart-type calculé en divisant par le nombre de matchs moins un (STA-16).
- H-STA-05 — Seul le match mesuré est retiré de sa référence ; les autres matchs mesurés de la saison y restent (STA-17).
- H-STA-06 — Les matchs du tournoi de qualification et des phases finales sont comparés à une référence de phases finales de la même saison ; option : la saison régulière (STA-18).
- H-STA-07 — Une référence exige au moins 10 matchs exploitables, match mesuré exclu (STA-19).
- H-STA-08 — Pour la saison en cours, la référence est provisoire, porte aussi sur les matchs joués après le match mesuré et devient définitive à la fin de la phase (STA-21).
- H-STA-09 — Comparaison indicative avec la saison régulière précédente tant que la référence est en constitution, jamais comptée (STA-23).
- H-STA-10 — Référence « partielle » au-delà de 20 % de matchs joués sans indice (STA-24).
- H-STA-11 — Un match dont l'heure n'est pas fixée est réputé commencer au début de sa journée locale (STA-31).
- H-STA-12 — Mise à jour quotidienne au plus tôt 3 heures après le dernier coup d'envoi de la journée de compétition (STA-32).
- H-STA-13 — Fenêtre de correction de 7 jours ; feuille indisponible après 30 jours (STA-33, STA-35).
- H-STA-14 — Nouvelles tentatives après 1 heure puis toutes les 4 heures ; incident après 12 heures d'échecs (STA-36, STA-37).
- H-STA-15 — Réserve de quota de 10 % et ordre de priorité des récupérations (STA-39, STA-40).
- H-STA-16 — Une saison non couverte par la source rend non mesurables les cas qui y tombent (STA-45).
- H-STA-17 — Une date d'intersaison est rattachée à la saison qui suit (STA-48).

Question locale :

- Q-STA-01 — Si aucune source gratuite ne fournit, sur toute la carrière des joueurs suivis (H-06), les douze éléments du Game Score et les minutes, faut-il accepter des profils limités aux saisons couvertes (comportement par défaut de STA-45), ou revoir l'indicateur choisi en D-13 et H-13 ? À trancher par l'utilisateur au moment du choix de la source (Q-02).
