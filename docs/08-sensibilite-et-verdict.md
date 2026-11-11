# 08 — Sensibilité et verdict

## Objet

Ce document transforme des événements en mesures. Il rattache chaque événement à son match mesuré, calcule l'écart normalisé de ce match par rapport à la référence de saison du joueur, écarte les cas douteux, puis agrège les cas en un profil de sensibilité par joueur et par type d'événement et en une tendance générale par type, avec un verdict à trois niveaux et un niveau de confiance, appelé confiance du profil. L'hypothèse de fond n'est pas démontrée et les échantillons par joueur seront petits : chaque règle vise à rendre l'incertitude visible et à empêcher l'application de se raconter une belle histoire.

## Décisions d'origine

- D-01 — L'hypothèse se vérifie en confrontant des événements passés aux statistiques réelles.
- D-04 — L'objet d'étude est la performance individuelle du joueur.
- D-05 — Le résultat est chiffré et sourcé, pas une alerte brute ni une recommandation de pari.
- D-07 — La référence est la moyenne de saison du joueur.
- D-08 — Le but est de détecter si un joueur est sensible à un type d'événement ; pas de pari.
- D-10 — Seuls comptent des événements connus avant le match, attestés par des sources datées.
- D-11 — Une tendance générale par type, affinée par joueur dès qu'il a assez de cas, avec un niveau de confiance affiché.
- D-13 — Indicateur global rapporté aux minutes jouées.
- D-16 — Écart rapporté à l'écart-type de saison ; verdict probable, possible ou non concluant.
- D-19 — Des champs de contexte (retour de blessure, niveau de l'adversaire, enjeu du match, temps de jeu) permettent d'exclure les cas douteux.
- D-29 — Chaque nouveau cas suivi enrichit le profil.
- D-31 — L'effet n'est attendu que chez certains joueurs.
- D-32 — Les convictions de départ reposent sur des exemples marquants, donc biaisés.
- D-34 — Type candidat « record négatif à éviter », qui se joue par nature dans un match à fort enjeu.
- D-35 — Aucun critère d'arrêt.
- H-01 — Tous les événements comptent, y compris ceux suivis d'une contre-performance.
- H-02 — Le match mesuré est le premier match joué après que l'événement est devenu public ; un événement publié après le coup d'envoi ne compte pas pour ce match.
- H-03 — Au moins 5 cas valides pour un verdict par joueur et par type ; en dessous, seule la tendance générale s'applique.
- H-04 — Une sensibilité négative est mesurée et affichée au même titre qu'une sensibilité positive.
- H-05 — Un backtest couvre les types validés à la date de la demande : un type validé plus tard n'est pas couvert (SEN-46).
- H-09 — Temps de jeu et niveau de l'adversaire calculés par l'application ; retour de blessure et enjeu signalés, puis corrigés par l'utilisateur.
- H-12 — Découpage en deux lots.
- H-13 — L'indice de performance est le Game Score divisé par les minutes jouées.

## Périmètre

Ce document couvre :

- le rattachement d'un événement à son match mesuré, y compris les absences prolongées et les événements multiples avant un même match ;
- le sort des événements dont l'antériorité ou la datation est douteuse ;
- les états d'un cas et leurs motifs, et le sort des cas restés en attente ;
- le calcul de l'écart normalisé ;
- les critères de cas douteux, les exclusions et les réintégrations manuelles ;
- le profil de sensibilité par joueur et par type, et la tendance générale par type ;
- le verdict, la confiance du profil, le test de robustesse, les contrôles et les avertissements affichés ;
- le comptage exhaustif, les effets de l'écartement et du retrait sur les calculs, le recalcul et l'affichage des petits échantillons ;
- un exemple chiffré complet et les pièges d'interprétation.

Il ne couvre pas :

- les statistiques, l'indice de performance, les références de saison, les bilans d'équipe et le prochain match : [07 — Statistiques de match](07-statistiques-de-match.md) ;
- la création des cas suivis, leur pronostic figé et le tableau de validation : [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) ;
- l'import des événements historiques, les doublons, la correction des événements et de leurs indications de contexte : [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) ;
- la détection, les indications de contexte des événements détectés et les événements écartés : [04 — Détection des événements](04-detection-des-evenements.md) ;
- la définition des types et de leurs fiches : [02 — Taxonomie des événements](02-taxonomie-des-evenements.md) ;
- le contenu de la fiche d'alerte : [09 — Fiche d'alerte](09-fiche-d-alerte.md) ;
- les écrans : [12 — Interface et accès](12-interface-et-acces.md) ; les messages : [11 — Notifications Telegram](11-notifications-telegram.md) ;
- le retrait d'un événement pour raison de confidentialité : [13 — Données sensibles](13-donnees-sensibles.md) ;
- le mécanisme de gestion des paramètres : [14 — Exigences transverses](14-exigences-transverses.md).

## Acteurs et déclencheurs

Acteurs :

- l'application, qui rattache, mesure, exclut, agrège et recalcule ;
- l'utilisateur, qui consulte les profils, exclut ou réintègre un cas avec un motif, modifie les paramètres et peut demander un recalcul complet.

Déclencheurs :

- l'enregistrement d'événements historiques par l'import ([06](06-import-des-resultats-de-recherche.md)) ;
- l'arrivée ou la correction de statistiques, et la fin d'une phase ([07](07-statistiques-de-match.md)) ;
- la création ou la mesure d'un cas suivi ([10](10-suivi-automatique-et-validation.md), lot 2) ;
- une décision manuelle d'exclusion ou de réintégration ;
- la correction, la fusion, l'écartement, la réintégration, la suppression ou le retrait d'un événement ([04](04-detection-des-evenements.md), [06](06-import-des-resultats-de-recherche.md), [13](13-donnees-sensibles.md)) ;
- un changement de paramètre, un changement de statut, une modification, une fusion ou une scission d'un type, la requalification d'un événement ([02](02-taxonomie-des-evenements.md)) ;
- la suppression des données d'un joueur retiré ([01](01-joueurs-suivis.md)) ;
- une demande de recalcul complet par l'utilisateur.

## Parcours

### Scénario nominal

1. Le document 06 enregistre les événements historiques du joueur A rapportés par un résultat de recherche.
2. Pour chaque événement, l'application fixe l'instant de référence (SEN-01, SEN-02).
3. Elle cherche le match mesuré parmi les matchs des équipes du joueur fournis par le document 07 (SEN-03, SEN-04).
4. Elle regroupe en un seul cas les événements d'un même type rattachés au même match et marque les cas concomitants (SEN-05, SEN-06).
5. Pour chaque cas dont le match mesuré est joué, elle obtient du document 07 l'indice et la référence, puis calcule l'écart normalisé (SEN-08).
6. Elle applique les critères de cas douteux (SEN-11 à SEN-16) ; chaque cas prend son état et son motif (SEN-07).
7. Elle calcule le profil de chaque couple joueur-type concerné et la tendance générale de chaque type concerné : décompte, écart moyen, fourchette, verdict, confiance du profil, contrôles et avertissements (SEN-19 à SEN-31, SEN-43, SEN-46).
8. Elle inscrit dans l'historique des verdicts tout changement de verdict ou de confiance du profil (SEN-37).
9. L'utilisateur consulte le profil : décompte des événements par état, liste des cas avec leurs sources, écart moyen et fourchette, verdict, confiance du profil et avertissements.

### Variantes

- Moins de 5 cas valides : le profil du joueur est non concluant et la tendance générale du type est affichée à côté, présentée comme telle (SEN-31).
- Joueur absent après l'événement : le match mesuré est le premier qu'il joue dans le délai maximal ; au-delà, le cas est non mesurable (SEN-04).
- Statistiques ou référence pas encore disponibles : le cas reste en attente du match avec son motif (SEN-07).
- Exclusion ou réintégration manuelle : le cas change d'état, la décision est tracée et le profil recalculé (SEN-17).
- Changement de paramètre : recalcul complet, tracé dans l'historique des verdicts (SEN-34, SEN-37).
- Cas suivi mesuré (lot 2) : il entre dans le profil comme tout cas valide ; le document 10 le traite à part dans le tableau de validation.

## Règles de gestion

### Rattachement d'un événement à son match mesuré

- SEN-01 [Lot 1] — L'instant de référence d'un événement est le moment où il est devenu public, tel qu'enregistré par le document 06 (événement historique) ou 04 (événement détecté). Quand seule la date est connue, l'événement est réputé devenu public à la fin de cette journée dans le fuseau horaire le plus à l'ouest où la ligue fait jouer ses matchs, celui de la côte Pacifique de l'Amérique du Nord (H-SEN-01, à confirmer). Cette règle de prudence écarte le match du jour même : beaucoup d'événements naissent pendant un match ou juste après, et mesurer ce match-là reviendrait à mesurer le match qui a provoqué l'événement.
- SEN-02 [Lot 1] — Exception : pour un type dont la règle de datation (TAX-01) indique que l'événement est connu à l'avance, par exemple un anniversaire, le match mesuré est le premier match joué dont la date, à l'heure locale du lieu du match, est égale ou postérieure à la date de l'événement (H-SEN-02, à confirmer). Cette indication doit pouvoir se lire sans ambiguïté dans la règle de datation de la fiche (document 02).
- SEN-03 [Lot 1] — Le match mesuré est le premier match officiel (07) d'une équipe du joueur dont l'instant prévu de début est strictement postérieur à l'instant de référence et dans lequel le joueur a joué (H-02). Un événement devenu public au coup d'envoi ou après ne compte pas pour ce match. Les matchs que le joueur n'a pas joués sont sautés et comptés comme absences. Un match joué n'est jamais sauté, même avec très peu de minutes ou une très mauvaise performance : le cas est alors examiné par les critères de cas douteux et ne glisse jamais vers un match suivant.
- SEN-04 [Lot 1] — Si le joueur ne joue aucun match dans les 10 jours (paramétrable) qui suivent l'instant de référence, le cas est non mesurable, motif « aucun match joué dans le délai » (H-SEN-03, à confirmer). Le délai se compte de l'instant de référence au début prévu du match. Cette règle couvre l'intersaison, la fin de saison d'une équipe éliminée et les longues absences ; la valeur par défaut couvre la pause du match des étoiles.
- SEN-05 [Lot 1] — Plusieurs événements d'un même type rattachés au même match forment un seul cas, qui les liste tous et retient comme instant de référence le plus ancien. Ce match ne compte qu'une fois dans le profil.
- SEN-06 [Lot 1] — Des événements de types différents rattachés au même match donnent un cas par type. Chacun est marqué « concomitant », avec la liste des autres types, et compte dans le profil de chaque type ; le profil affiche son nombre de cas concomitants. Un paramètre permet de traiter les cas concomitants comme des cas douteux (valeur par défaut : non) (H-SEN-04, à confirmer).
- SEN-07 [Lot 1] — Un cas est dans un et un seul des états communs, avec son motif :
  - en attente du match : match pas encore joué ; statistiques en attente, y compris une feuille incomplète ou douteuse tant que le match n'est pas consolidé (07) ; correspondance statistique non confirmée (STA-03) ; référence en constitution ; antériorité à vérifier (SEN-44) ; datation à vérifier (SEN-45) ;
  - mesuré : écart normalisé calculé et aucun critère de cas douteux retenu ; c'est un cas valide ;
  - exclu (cas douteux) : un ou plusieurs critères retenus, automatiques ou manuels ;
  - non mesurable : aucun match joué dans le délai ; feuille incomplète, douteuse ou indisponible une fois le match consolidé ; référence insuffisante ; saison non couverte par la source ; antériorité non établie (SEN-44).
- SEN-44 [Lot 1] — Antériorité d'un événement historique. Le classement de l'antériorité de la source sur le match mesuré appartient au document 06 (IMP-18) ; ses effets sur le calcul sont les suivants (D-10, H-02) :
  - « établie » : le cas suit les règles ordinaires ;
  - « non établie » (toutes les sources sont postérieures au coup d'envoi) : l'événement ne produit aucun cas compté (H-IMP-07). Son cas est non mesurable, motif « antériorité non établie » : il reste dans le décompte (SEN-32), mais son écart n'est jamais calculé, pas même pour le contrôle de SEN-27. Un fait attesté seulement après un match a pu être rapporté à cause de ce match (D-32) ;
  - « à vérifier » (dates de matchs encore inconnues) : le cas reste en attente du match, motif « antériorité à vérifier », et n'entre dans aucun calcul tant que le classement n'est pas fait ;
  - « incertaine » (la plus ancienne source date du jour du match mesuré, sans heure) : par la même prudence qu'en SEN-01, cette source est réputée publiée à la fin de sa journée, heure de la côte Pacifique ; le match de ce jour ne compte donc pas, et le match mesuré est le premier match joué ensuite (SEN-03). Le cas porte la mention « antériorité incertaine » (H-SEN-15, à confirmer). Ce report ne peut qu'atténuer un effet réel, jamais le créer.
  Le classement d'IMP-18 porte toujours sur le match que donnent SEN-01 à SEN-03 avant tout report, si bien qu'un report pour antériorité incertaine ne se défait pas de lui-même. L'ajout d'une source plus ancienne (IMP-32) relance le classement et le rattachement.
- SEN-45 [Lot 2] — Datation à vérifier. Tant qu'un événement détecté porte la marque « datation à vérifier » (DET-32), son cas reste en attente du match, motif « datation à vérifier », et n'entre dans aucun calcul : le fait a pu devenir public avant un match déjà joué, qui serait alors son vrai match mesuré (H-02) (H-SEN-17, à confirmer). L'événement figure dans la liste « à faire » ([12](12-interface-et-acces.md)). Quand l'utilisateur lève la marque, le cas est rattaché à partir de la date de référence ; quand il avance celle-ci (DET-48), le rattachement est refait. Le document 10 compte à part un cas suivi dont la marque est traitée après le coup d'envoi (SUI-17).
- SEN-47 [Lot 1] — Sort des cas restés en attente. Aucun cas n'attend sans motif visible, et chaque motif a son issue : match pas encore joué, issue de SEN-03 ou de SEN-04 ; référence en constitution, mesure dès que le minimum est atteint, ou référence insuffisante en fin de phase (STA-22) ; feuille manquante, feuille indisponible au terme du délai de STA-35 ; antériorité ou datation à vérifier, SEN-44 et SEN-45. Seules une panne de la source de statistiques (STA-36) et une correspondance statistique non confirmée (STA-03, JOU-10) peuvent prolonger l'attente sans limite ; la première est un incident, la seconde figure dans la liste « à faire ». La mise en pause ou le retrait du joueur ne change rien à ces règles (JOU-17, JOU-19).

### Écart normalisé

- SEN-08 [Lot 1] — Pour un cas dont le match mesuré a un indice et une référence (STA-12, STA-16), l'écart normalisé est égal à l'indice de performance du match mesuré moins la moyenne de la référence, le tout divisé par l'écart-type de la référence. La référence est celle de la saison et de la phase du match mesuré, match mesuré exclu. Un écart de +0,5 signifie que le joueur a joué au-dessus de son niveau habituel de la moitié de sa variabilité habituelle ; un écart de −1, qu'il a joué en dessous d'une fois cette variabilité. Le résultat du match, victoire ou défaite de l'équipe, n'entre jamais dans la mesure (D-04, VUE-03).
- SEN-09 [Lot 1] — L'écart est provisoire tant que sa référence l'est (07), définitif ensuite. Il est arrondi à deux décimales à l'affichage, jamais dans les calculs.
- SEN-10 [Lot 1] — L'écart est aussi calculé, quand c'est possible, pour les cas exclus : il est affiché sur le cas et sert au contrôle de SEN-27, mais n'entre jamais dans un verdict.

### Cas douteux

- SEN-11 [Lot 1] — Un cas est douteux dès qu'un critère de SEN-12 à SEN-15 est retenu, ou celui de SEN-06 si son paramètre est activé, ou par décision manuelle (SEN-17) ; il passe à l'état exclu avec la liste de tous les critères retenus et des valeurs qui les déclenchent. Aucun critère ne regarde la performance du match mesuré : ils portent sur le temps de jeu, les absences, l'enjeu, l'adversaire et la concomitance. Aucun écart n'est exclu parce qu'il est extrême.
- SEN-12 [Lot 1] — Temps de jeu trop faible : le match mesuré n'atteint pas le seuil de temps de jeu défini par le document 07 (STA-14, H-STA-03), que l'application calcule à partir des statistiques (H-09). C'est le même seuil que pour les matchs de la référence (STA-15).
- SEN-13 [Lot 1] — Retour de blessure : le critère est retenu si l'une des deux conditions suivantes est remplie (H-SEN-05, à confirmer) :
  - signalée : l'indication « retour de blessure » vaut « oui » (valeurs du document 05 : oui, non, inconnu), qu'elle vienne de la recherche approfondie (06), de la classification (04) ou de l'utilisateur (H-09). Le prompt (05) et la classification (04) reprennent cette définition : « oui » quand la presse présente le match mesuré comme le retour du joueur, ou comme l'un de ses premiers matchs, après une absence due à une blessure, sans jamais préciser la blessure (DSN-07) ; « non » sinon ; « inconnu » quand on ne peut l'établir ;
  - calculée : le match mesuré est l'un des 2 premiers matchs (paramétrable) joués après une absence d'au moins 4 matchs consécutifs de son équipe (paramétrable), quelle qu'en soit la cause.
  La valeur « inconnu » ne déclenche rien : seule la condition calculée s'applique alors.
- SEN-14 [Lot 1] — Enjeu inhabituel : le critère est retenu si l'une des deux conditions suivantes est remplie (H-SEN-06, à confirmer) :
  - calculée : le match mesuré est un match du tournoi de qualification, ou un match de phases finales dont la défaite élimine l'une des deux équipes (STA-07) ;
  - signalée : l'indication « enjeu du match » vaut « fort » (valeurs du document 05 : fort, normal, inconnu), qu'elle vienne de la recherche, de la classification ou de l'utilisateur. Le prompt du document 05 et la classification du document 04 reprennent cette définition : « fort » désigne un match dont l'issue décide directement d'une qualification, d'une élimination, d'un titre ou d'un classement final, c'est-à-dire un match du tournoi de qualification, un match de phases finales dont la défaite élimine l'une des deux équipes, ou un match de saison régulière à un tel enjeu ; tout autre match est « normal », y compris un match de phases finales qui n'élimine personne ; « inconnu » ne déclenche rien.
  Les autres matchs de phases finales ne sont pas retenus par défaut, puisqu'ils sont comparés à une référence de phases finales (07) ; un paramètre permet de traiter tout match de phases finales comme un enjeu inhabituel (valeur par défaut : non).
- SEN-15 [Lot 1] — Niveau de l'adversaire : le critère est retenu si le pourcentage de victoires de l'adversaire en saison régulière de la même saison, match mesuré exclu (STA-06), est inférieur à 25 % ou supérieur à 75 % (paramétrables). Si l'adversaire a joué moins de 10 matchs (paramétrable) hors match mesuré, on utilise son pourcentage final de la saison précédente ; s'il n'en a pas, le critère est non évaluable, n'est pas retenu et le cas le mentionne (H-SEN-07, à confirmer). Pour la saison en cours, ce pourcentage est provisoire, comme la référence.
- SEN-16 [Lot 1] — Situations signalées pour revue, sans exclusion automatique : premier match du joueur avec une nouvelle équipe ; expulsion du joueur pendant le match mesuré, quand la source l'indique. L'application les signale sur le cas et dans la liste « à faire » ([12](12-interface-et-acces.md)) ; l'utilisateur décide (H-SEN-08, à confirmer). C'est la réponse par défaut à la question Q-JOU-01 du document 01 : le premier match avec une nouvelle équipe n'est pas un facteur parasite automatique.
- SEN-17 [Lot 1] — L'utilisateur peut exclure à la main un cas mesuré, ou réintégrer un cas exclu (H-SEN-09, à confirmer). Le motif est obligatoire et choisi dans une liste fermée. Pour exclure : temps de jeu, retour de blessure, enjeu inhabituel, niveau de l'adversaire, autre facteur parasite. Pour réintégrer : indication de contexte erronée, critère inadapté à ce cas. Un commentaire est obligatoire pour « autre facteur parasite » et « critère inadapté à ce cas ». Aucun motif ne peut porter sur la performance elle-même. Chaque décision est tracée (date, motif, commentaire, état précédent), réversible, prime sur les critères automatiques et survit aux recalculs et aux changements de paramètres. Pour un cas suivi, une décision prise après le coup d'envoi est comptée à part dans le tableau de validation (SUI-17). La correction d'une indication de contexte elle-même relève du document 06 pour un événement historique (IMP-32) et du document 04 pour un événement détecté (DET-47).
- SEN-18 [Lot 1] — Chaque cas affiche ses critères retenus, ses signalements et l'éventuelle décision manuelle, avec la provenance de chaque indication de contexte (recherche, classification, utilisateur ou calcul).

### Profil de sensibilité

- SEN-19 [Lot 1] — Un profil existe pour chaque couple formé d'un joueur et d'un type validé dès qu'au moins un événement de ce type concerne ce joueur. Un type proposé ou rejeté n'a pas de profil. Les profils d'un joueur retiré (JOU-19) et les profils et la tendance générale d'un type retiré (TAX-31) restent consultables et recalculés, présentés comme « archivés » ; ils ne nourrissent aucune fiche d'alerte. Les cas valides d'un joueur retiré continuent de compter dans la tendance générale de chaque type (H-JOU-07) ; les cas d'un type retiré ne comptent plus que dans ses profils et sa tendance archivés. Les couples archivés restent comptés dans SEN-41, puisqu'ils ont été examinés.
- SEN-20 [Lot 1] — Le profil indique :
  - le décompte : événements, cas, événements regroupés dans un cas existant, cas en attente, cas valides, cas exclus (dont exclus à la main), cas non mesurables, chacun avec ses motifs ; cas concomitants ; cas dont l'écart est provisoire ;
  - n, le nombre de cas valides ;
  - l'écart moyen, égal à la somme des écarts normalisés des cas valides divisée par n ;
  - la dispersion des écarts, égale à la racine carrée de la somme des carrés des différences entre l'écart de chaque cas valide et l'écart moyen, divisée par n moins un ;
  - le nombre de cas valides au-dessus et en dessous de zéro ;
  - la fourchette plausible, le verdict et son sens, la confiance du profil et ses raisons, les contrôles et avertissements (SEN-27, SEN-43, SEN-46) ;
  - le seuil de cas valides en vigueur, la liste des cas et la date du dernier calcul.
- SEN-21 [Lot 2] — Le profil, comme la tendance générale (SEN-28), peut être calculé sur tous les cas valides (vue par défaut, utilisée par le document 09), sur les seuls cas historiques ou sur les seuls cas suivis (vues utilisées par le document 10). Il affiche toujours le nombre de cas valides de chaque origine.
- SEN-43 [Lot 1] — Confiance de la recherche « faible ». Un événement historique dont la confiance de la recherche (document 05) vaut « faible » est compté comme les autres : son cas suit les mêmes règles et entre dans le verdict s'il est valide (H-SEN-16, à confirmer). Le profil et la tendance générale affichent le nombre de leurs cas valides qui reposent sur un tel événement. La question de les écarter des calculs reste ouverte (Q-BKT-01 du document 05).
- SEN-46 [Lot 1] — Avertissements de couverture et de version. Sans changer le verdict, le profil affiche : « type non couvert par le backtest » quand la couverture du joueur (BKT-10) ne comprend pas le type, le profil ne reposant alors que sur des cas suivis (TAX-20) ; « profil incomplet » quand la couverture du type présente des manques (BKT-06) ou qu'une modification qui élargit la fiche attend sa demande complémentaire (TAX-24) ; le nombre de cas qui reposent sur une version antérieure de la fiche (TAX-25) ; le nombre de refus restants du dernier import du joueur (IMP-24). La tendance générale affiche le nombre de ses cas fondés sur une version antérieure et le nombre de joueurs dont le profil est incomplet.

### Verdict

- SEN-22 [Lot 1] — Trois grandeurs servent au verdict :
  - la dispersion retenue, égale à la plus grande des deux valeurs entre la dispersion des écarts et 1, et égale à 1 s'il y a moins de deux cas : sans effet réel, les écarts d'un joueur ont par construction une dispersion voisine de 1, et une dispersion plus faible observée sur peu de cas tient le plus souvent du hasard ; elle ne doit pas rendre le résultat plus sûr qu'il n'est ;
  - le bruit attendu, égal à la dispersion retenue divisée par la racine carrée de n : c'est l'ampleur que le hasard donne couramment à une moyenne de n cas ;
  - le rapport signal sur bruit, égal à l'écart moyen divisé par le bruit attendu.
  La fourchette plausible va de l'écart moyen moins deux fois le bruit attendu à l'écart moyen plus deux fois le bruit attendu.
- SEN-23 [Lot 1] — Le verdict d'un profil est (H-SEN-10, valeurs à confirmer, Q-04) :
  - non concluant si n est inférieur au seuil de 5 cas valides (H-03, paramétrable) ;
  - probable si la valeur absolue du rapport signal sur bruit atteint 3 et la valeur absolue de l'écart moyen atteint 0,40 ;
  - possible si, sans être probable, la valeur absolue du rapport atteint 2 et celle de l'écart moyen atteint 0,25 ;
  - non concluant dans tous les autres cas.
  Un verdict possible signifie que la fourchette plausible exclut zéro et que l'effet n'est pas négligeable ; un verdict probable exige un signal nettement plus fort, parce que de nombreux couples sont examinés (voir « Pièges d'interprétation »). Les quatre valeurs (2 ; 3 ; 0,25 ; 0,40) sont paramétrables.
- SEN-24 [Lot 1] — Un verdict possible ou probable porte un sens : « hausse » si l'écart moyen est positif, « baisse » s'il est négatif. Les seuils s'appliquent en valeur absolue, et une sensibilité à la baisse est calculée, nommée et affichée exactement comme une sensibilité à la hausse (H-04).

### Confiance du profil

- SEN-25 [Lot 1] — La confiance du profil (faible, moyen ou élevé), c'est-à-dire le niveau de confiance de D-11 attaché à un profil ou à une tendance générale, dit sur quelle base repose le verdict, quel qu'il soit (H-SEN-11, valeurs à confirmer). Elle ne se confond ni avec la confiance de détection du document 04, ni avec la confiance de la recherche du document 05 :
  - niveau de départ selon n : faible en dessous de 8 cas valides, moyen de 8 à 14, élevé à partir de 15 (paramétrables) ;
  - baisse d'un niveau si la dispersion des écarts dépasse 1,5 (paramétrable) : les cas se contredisent ;
  - baisse d'un niveau si la part de cas douteux, égale au nombre de cas exclus divisé par la somme des cas valides et des cas exclus, dépasse 30 % (paramétrable) : la base a dû être fortement triée ;
  - baisse d'un niveau si le verdict est fragile (SEN-26) ;
  - jamais en dessous de faible ; le profil affiche la raison de chaque baisse.
- SEN-26 [Lot 1] — Test de robustesse : l'application recalcule le verdict après avoir retiré le cas qui le soutient le plus, c'est-à-dire l'écart le plus élevé pour un verdict à la hausse, le plus bas pour un verdict à la baisse ; pour un verdict non concluant, elle retire tour à tour l'écart le plus élevé et l'écart le plus bas. Ce recalcul applique les seuils de SEN-23, sauf le seuil de nombre de cas. Si le niveau ou le sens du verdict change, le verdict est « fragile » : un seul match suffit à le faire basculer.
- SEN-27 [Lot 1] — Deux contrôles sont affichés, sans jamais remplacer le verdict (H-SEN-12, à confirmer) :
  - l'écart moyen de contrôle, calculé sur les cas valides et sur les cas exclus dont l'écart est calculable, avec le verdict qu'il donnerait ;
  - l'avertissement « verdict dépendant des exclusions manuelles », si l'annulation de toutes les décisions manuelles du profil changeait le niveau ou le sens du verdict.

### Tendance générale

- SEN-28 [Lot 1] — La tendance générale d'un type se calcule comme un profil, sur tous les cas valides du type, tous joueurs confondus, chaque cas pesant autant (D-11 ; voir Q-SEN-02). Elle indique en plus le nombre de joueurs distincts et la part du joueur qui apporte le plus de cas valides.
- SEN-29 [Lot 1] — Son verdict suit SEN-23 et exige en plus des cas valides d'au moins 3 joueurs distincts (paramétrable) ; sinon il est non concluant. Sa confiance suit SEN-25 et baisse en plus d'un niveau si un seul joueur apporte plus de 50 % des cas valides (paramétrable) (H-SEN-13, à confirmer).
- SEN-30 [Lot 1] — La tendance générale décrit l'ensemble des joueurs observés, pas un joueur donné : puisque l'effet n'est attendu que chez certains joueurs (D-31), une tendance faible peut cacher quelques joueurs sensibles, et une tendance nette peut venir de quelques joueurs seulement. Ce rappel accompagne chaque affichage d'une tendance.
- SEN-31 [Lot 1] — Quand un joueur a, pour un type, moins de cas valides que le seuil de H-03, son profil affiche « non concluant pour ce joueur (k cas valides sur 5 nécessaires) », la liste de ses cas, leur écart moyen avec sa fourchette, et la tendance générale du type sous le titre « tendance générale du type, ne décrit pas ce joueur ». La tendance n'est jamais présentée comme le verdict du joueur ; les documents 09, 10, 11 et 12 suivent la même règle et les mêmes libellés.

### Comptage exhaustif

- SEN-32 [Lot 1] — Tout événement d'un type validé concernant un joueur donne un cas ou rejoint un cas existant (SEN-05), quel que soit le résultat du match (H-01). Le décompte du profil se vérifie toujours : le nombre d'événements est égal au nombre de cas plus le nombre d'événements regroupés dans un cas existant, et le nombre de cas est égal à la somme des cas en attente, valides, exclus et non mesurables.
- SEN-33 [Lot 1] — Un événement ne quitte le décompte que s'il est écarté (DET-44), jusqu'à une éventuelle réintégration (DET-45) ; fusionné avec un autre événement détecté (DET-47) ; supprimé à la main ou par un remplacement à l'import (IMP-33, IMP-29) ; effacé lors d'une requalification ou d'une répartition après scission (TAX-25, TAX-29) ; ou retiré pour raison de confidentialité (13), y compris lors de la suppression des données d'un joueur (JOU-24). Un changement de type le fait passer d'un profil à un autre. Chaque sortie est tracée et le profil affiche le nombre d'événements sortis du décompte, par motif, sauf le retrait, qui ne laisse aucune trace par joueur ni par type : seul le compteur global de DSN-29 le compte, comme les événements qu'un import laisse de côté pour donnée sensible (IMP-37), qui n'entrent jamais dans le décompte. Aucune règle et aucune action de l'utilisateur ne sélectionne des cas d'après leur écart.
- SEN-48 [Lot 1] — Écartement et retrait. L'écartement d'un événement détecté (lot 2) corrige une erreur de détection : il fait sortir l'événement et son cas des profils et des tendances sans rien effacer, le cas gardant son état et son écart, visibles depuis l'événement écarté ; la réintégration (DET-45) les fait rentrer dans les calculs. Le retrait (DSN-26, DSN-27) efface l'événement et son cas : les profils et les tendances sont recalculés comme si l'événement n'avait jamais existé. Dans l'historique des verdicts (SEN-37), un changement dû à un écartement porte la cause « événement écarté » ; un changement dû à un retrait porte la cause générique « recalcul », la même que pour un recalcul demandé par l'utilisateur, pour ne rien révéler de l'événement retiré (DSN-29).

### Recalcul

- SEN-34 [Lot 1] — Le recalcul porte sur ce qui a changé :
  - import du document 06 : rattachement et mesure des nouveaux cas, puis profils du joueur et tendances des types concernés ;
  - nouvelle feuille, correction ou fin de phase signalée par le document 07 : cas dont le match mesuré, la référence, le décompte d'absences ou le bilan de l'adversaire changent, puis leurs profils et tendances ; pour la saison en cours, chaque nouveau match d'un joueur modifie sa référence provisoire et donc les écarts de tous ses cas de la saison ;
  - décision manuelle ; correction d'un événement, de son type ou de ses indications de contexte ; requalification, réaffectation ou répartition d'un événement (TAX-25, TAX-29) ; événement écarté, réintégré, fusionné, supprimé, remplacé à l'import ou retiré : cas concernés, puis leurs profils et tendances ;
  - changement de paramètre, changement de statut, fusion ou scission d'un type, suppression des données d'un joueur (JOU-24), ou demande de l'utilisateur : recalcul complet de tous les cas, profils et tendances.
- SEN-35 [Lot 2] — La création ou la mesure d'un cas suivi ([10](10-suivi-automatique-et-validation.md)) déclenche le recalcul de son profil et de la tendance de son type.
- SEN-36 [Lot 1] — Le recalcul est déterministe : les mêmes données et les mêmes paramètres donnent toujours les mêmes résultats. Il préserve les décisions manuelles et se termine avec le traitement qui l'a déclenché ; pendant un recalcul, les profils concernés l'indiquent. Il ne redemande rien à la source de statistiques (07).
- SEN-37 [Lot 1] — Tout changement de niveau ou de sens d'un verdict, ou de confiance du profil, est inscrit dans l'historique des verdicts : date, profil ou tendance, ancienne et nouvelle valeur, cause (nouveaux cas, correction de statistiques, référence mise à jour, décision manuelle, événement écarté, changement de paramètre, ou « recalcul » pour un recalcul demandé par l'utilisateur ou dû à un retrait, SEN-48). La liste des profils affiche la date du dernier changement de paramètre.

### Affichage honnête des petits échantillons

- SEN-38 [Lot 1] — Tout écart moyen est affiché avec son nombre de cas et sa fourchette plausible. Aucun verdict n'est affiché sans son nombre de cas valides et sa confiance du profil.
- SEN-39 [Lot 1] — En dessous de 20 cas (paramétrable), les proportions s'affichent en nombres (« 5 cas sur 7 au-dessus de zéro ») et jamais en pourcentage (H-SEN-14, à confirmer).
- SEN-40 [Lot 1] — La liste des cas est toujours accessible depuis un profil ou une tendance : événements et liens vers leurs sources, instant de référence, match mesuré, minutes, indice, référence utilisée, écart, état et motifs.
- SEN-41 [Lot 1] — Avec la liste des profils, l'application affiche le nombre de couples joueur-type évalués (au moins 5 cas valides), couples archivés compris (SEN-19), et le nombre de verdicts que le hasard seul produirait si aucun effet n'existait : nombre de couples multiplié par 4,6 % pour les verdicts au moins possibles, et par 0,27 % pour les verdicts probables (H-SEN-14, à confirmer). Ces proportions correspondent aux seuils par défaut de 2 et 3 ; si ces seuils changent, elles sont recalculées comme la part des fluctuations purement aléatoires, suivant la courbe en cloche habituelle (loi normale), qui dépassent le nouveau seuil dans un sens ou dans l'autre.
- SEN-42 [Lot 1] — Un verdict décrit une association observée entre des événements et des matchs, pas une cause démontrée. Aucun libellé ne le présente comme une certitude ni comme une indication de pari (D-08, Q-05).

## Exemple chiffré complet

Le joueur A est fictif. « Humiliation publique » est un type candidat, supposé validé pour l'exemple. Les paramètres ont leurs valeurs par défaut. Pour que chaque calcul puisse être refait à la main, l'exemple enchaîne les valeurs arrondies qu'il affiche : indices et références à trois décimales, écarts à deux décimales.

### Étape 1 — Rattachement et états

Le résultat de recherche rapporte 12 événements de ce type entre 2018 et 2025.

- E1 (saison 2018-2019) : match mesuré deux jours plus tard ; cas C1.
- E2 (2019-2020) : devenu public à 22 h 10, heure de la côte Est, alors que le match de l'équipe avait commencé à 19 h 30 ; ce match ne compte pas et le match mesuré est le suivant (SEN-03) ; cas C2.
- E3 (2019-2020) : cas C3.
- E4 (2020-2021) : le joueur, qui joue en moyenne 35 minutes, se blesse au premier quart-temps et ne joue que 14 minutes, sous son seuil de 17,5 minutes ; cas C4, exclu pour temps de jeu trop faible ; le match n'est pas remplacé par le suivant.
- E5 (2020-2021) : seule la date du 15 janvier est connue ; l'événement est réputé public à la fin du 15 janvier, heure du Pacifique ; le match du 15 au soir ne compte pas et le match mesuré est celui du 17 janvier (SEN-01) ; cas C5.
- E6 (juillet 2021) : le premier match suivant a lieu en octobre, au-delà du délai de 10 jours ; cas C6, non mesurable.
- E7 (2021-2022) : cas C7.
- E8 (2022-2023) : cas C8.
- E9 (phases finales 2022-2023) : match 6 d'une série où l'équipe du joueur est menée 2 victoires à 3, si bien qu'une défaite l'élimine ; cas C9, exclu pour enjeu inhabituel.
- E10 et E11 (2023-2024) : la déclaration moqueuse d'un adversaire un lundi, puis la chronique d'un média national qui ridiculise le joueur le mardi, avant le match du mercredi ; un seul cas, C10 (SEN-05).
- E12 (2024-2025) : le joueur manque deux matchs et joue le troisième, six jours après l'événement ; deux absences ne suffisent pas pour le critère de retour de blessure, qui en demande quatre ; cas C11.

Décompte : les 12 événements donnent 11 cas, E11 étant regroupé avec E10 ; 8 cas valides, 2 exclus, 1 non mesurable, aucun en attente. La vérification de SEN-32 tient : 12 = 11 + 1 et 11 = 0 + 8 + 2 + 1.

### Étape 2 — Indice et écart du cas C1

Feuille du match mesuré : 34 minutes 30 secondes, 31 points, 11 tirs réussis sur 20, 7 lancers francs réussis sur 8, 1 rebond offensif, 6 rebonds défensifs, 7 passes décisives, 2 interceptions, 1 contre, 4 balles perdues, 3 fautes.

- Game Score : 31 points, plus 4,4 (0,4 fois 11), moins 14 (0,7 fois 20), moins 0,4 (0,4 fois 1 lancer franc manqué), plus 0,7 (0,7 fois 1 rebond offensif), plus 1,8 (0,3 fois 6), plus 2 (interceptions), plus 4,9 (0,7 fois 7), plus 0,7 (0,7 fois 1 contre), moins 1,2 (0,4 fois 3), moins 4 (balles perdues), soit 25,9.
- Indice : 25,9 divisé par 34,5, soit 0,751.
- Référence de la saison régulière 2018-2019, match mesuré exclu : 68 matchs, moyenne 0,513, écart-type 0,205.
- Écart normalisé : (0,751 − 0,513) ÷ 0,205 = 1,16.

### Étape 3 — Les autres cas

Même méthode pour chaque cas ; chaque référence est celle de la saison et de la phase du match mesuré, sans ce match.

- C2 : indice 0,498 ; référence 2019-2020 de 70 matchs, moyenne 0,587, écart-type 0,208 ; écart −0,43.
- C3 : indice 0,780 ; référence 2019-2020 de 70 matchs, moyenne 0,583, écart-type 0,207 ; écart +0,95. Les références de C2 et C3 diffèrent légèrement parce que chacune exclut son propre match.
- C5 : indice 0,668 ; référence 2020-2021 de 63 matchs, moyenne 0,558, écart-type 0,201 ; écart +0,55.
- C7 : indice 0,980 ; référence 2021-2022 de 65 matchs, moyenne 0,599, écart-type 0,211 ; écart +1,81.
- C8 : indice 0,533 ; référence 2022-2023 de 57 matchs, moyenne 0,576, écart-type 0,212 ; écart −0,20.
- C10 : indice 0,818 ; référence 2023-2024 de 69 matchs, moyenne 0,587, écart-type 0,205 ; écart +1,13.
- C11 : indice 0,892 ; référence 2024-2025 de 61 matchs, moyenne 0,595, écart-type 0,208 ; écart +1,43.
- Cas exclus, dont l'écart sert seulement au contrôle : C4, indice 0,180 contre une référence 2020-2021 de 64 matchs (son match de 14 minutes n'y figure pas, n'étant pas exploitable), moyenne 0,560, écart-type 0,200, soit −1,90 ; C9, indice 0,660 contre la référence des phases finales 2022-2023 de 12 matchs, moyenne 0,540, écart-type 0,190, soit +0,63.

### Étape 4 — Profil

- n = 8 cas valides. Somme des écarts : 1,16 − 0,43 + 0,95 + 0,55 + 1,81 − 0,20 + 1,13 + 1,43 = 6,40. Écart moyen : 6,40 ÷ 8 = 0,80.
- Dispersion des écarts : les différences à 0,80 valent 0,36 ; −1,23 ; 0,15 ; −0,25 ; 1,01 ; −1,00 ; 0,33 ; 0,63 ; la somme de leurs carrés vaut 4,2534 ; divisée par 7, elle donne 0,6076, dont la racine carrée est 0,78.
- Dispersion retenue : 1, plus grande valeur entre 0,78 et 1.
- Bruit attendu : 1 divisé par la racine carrée de 8 (2,828), soit 0,354.
- Rapport signal sur bruit : 0,80 ÷ 0,354 = 2,26.
- Fourchette plausible : de 0,80 − 0,71 à 0,80 + 0,71, soit de +0,09 à +1,51.
- Verdict : n atteint 5 ; le rapport atteint 2 sans atteindre 3 ; l'écart moyen dépasse 0,25 : possible, à la hausse. 6 cas sur 8 sont au-dessus de zéro.

### Étape 5 — Robustesse et confiance du profil

- Test de robustesse : sans C7 (+1,81), il reste 7 cas, de somme 4,59 et d'écart moyen 0,656 ; leur dispersion (0,72) est retenue à 1 ; le bruit attendu vaut 1 divisé par la racine carrée de 7, soit 0,378 ; le rapport tombe à 1,7 environ, sous 2, et le verdict deviendrait non concluant. Le verdict est donc fragile.
- Confiance du profil : départ « moyen » (8 cas) ; dispersion de 0,78, sous 1,5 : pas de baisse ; part de cas douteux de 2 ÷ (8 + 2) = 20 %, sous 30 % : pas de baisse ; verdict fragile : baisse d'un niveau. Résultat : faible.

### Étape 6 — Contrôles

- Écart moyen de contrôle, cas exclus compris : 10 cas, somme 6,40 − 1,90 + 0,63 = 5,13, moyenne 0,51 ; la dispersion de ces 10 écarts vaut 1,09, d'où un bruit attendu de 1,09 ÷ 3,162 = 0,345 et un rapport de 1,5 environ : ce contrôle serait non concluant. Le verdict officiel dépend donc des deux exclusions automatiques, et l'utilisateur le voit.
- Aucune décision manuelle : pas d'avertissement sur les exclusions manuelles.

### Étape 7 — Ce que voit l'utilisateur

« Joueur A, humiliation publique : possible, à la hausse. Écart moyen +0,80 sur 8 cas valides (fourchette de +0,09 à +1,51). Confiance du profil faible : le verdict est fragile, il ne tient plus sans le cas C7. 6 cas sur 8 au-dessus de zéro. 12 événements : 8 cas valides, 2 exclus (temps de jeu, enjeu inhabituel), 1 non mesurable (aucun match dans le délai), 1 événement regroupé. Contrôle, cas exclus compris : +0,51 sur 10 cas, non concluant. »

C'est un indice faible. Si l'application évalue 50 couples joueur-type, le hasard seul produit en moyenne un peu plus de deux verdicts au moins possibles (SEN-41). Ce profil mérite d'être suivi en conditions réelles ([10](10-suivi-automatique-et-validation.md)), pas d'être cru.

### Variante — trop peu de cas

Si le joueur A n'avait que 4 cas valides pour ce type, son profil serait « non concluant pour ce joueur (4 cas valides sur 5 nécessaires) ». L'application afficherait à côté la tendance générale du type, par exemple : écart moyen +0,31 sur 63 cas valides de 11 joueurs, dispersion 1,12, bruit attendu de 1,12 divisé par la racine carrée de 63 (7,94), soit 0,141, rapport 2,2 ; verdict possible, à la hausse, pour l'ensemble des joueurs observés, sans rien dire du joueur A en particulier (SEN-30, SEN-31).

## Données manipulées

- Cas : joueur ; type ; origine (historique ou suivi) ; événement ou événements rattachés, avec pour un événement historique sa confiance de la recherche et son antériorité (IMP-18) ; instant de référence et sa provenance (instant connu, date seule, événement connu à l'avance, report pour antériorité incertaine) ; match mesuré ; nombre de matchs de l'équipe manqués juste avant ; minutes ; indice ; référence utilisée (saison, phase, nombre de matchs, moyenne, écart-type, état, mention « partielle ») ; écart normalisé, provisoire ou définitif ; état et motif ; critères de cas douteux retenus et leurs valeurs ; signalements pour revue ; décisions manuelles (date, motif, commentaire) ; marque « concomitant » ; historique des changements d'état, de match mesuré et d'écart.
- Profil de sensibilité : joueur ; type ; vue (tous les cas, cas historiques, cas suivis) ; décompte ; n ; écart moyen ; dispersion observée et retenue ; bruit attendu ; rapport signal sur bruit ; fourchette ; verdict (niveau et sens) ; fragilité ; confiance du profil et raisons des baisses ; avertissements de SEN-46 ; nombre de cas de confiance de la recherche « faible » (SEN-43) ; mention « archivé » ; écart et verdict de contrôle ; avertissement sur les exclusions manuelles ; nombres de cas provisoires et concomitants ; date du dernier calcul.
- Tendance générale : les mêmes éléments, plus le nombre de joueurs distincts et la part du premier contributeur.
- Historique des verdicts : date, profil ou tendance, ancienne et nouvelle valeur, cause.
- Synthèse des faux signaux attendus : nombre de couples évalués, nombres de verdicts attendus du seul hasard, date du calcul.
- Paramètres de ce document, avec leur valeur par défaut : délai maximal de rattachement (10 jours) ; cas concomitants traités comme douteux (non) ; retour de blessure (absence de 4 matchs, 2 premiers matchs) ; tout match de phases finales traité comme enjeu inhabituel (non) ; niveau de l'adversaire (25 %, 75 %, minimum de 10 matchs) ; seuil de cas valides (5, H-03) ; seuils du verdict (2 ; 3 ; 0,25 ; 0,40) ; confiance du profil (8 et 15 cas, dispersion 1,5, part de cas douteux 30 %) ; tendance (3 joueurs, part maximale de 50 %) ; affichage en nombres sous 20 cas.

## Cas limites et erreurs

- Événement devenu public pendant un match : il ne compte pas pour ce match ; le match mesuré est le suivant que le joueur joue.
- Événement entre la fin de la saison régulière et le début des phases finales : le match mesuré est le premier match de phases finales, comparé à la référence des phases finales (07).
- Joueur transféré entre l'événement et le match mesuré : le match mesuré est son premier match avec sa nouvelle équipe, signalé pour revue (SEN-16).
- Joueur expulsé pendant le match mesuré : souvent exclu pour temps de jeu trop faible ; comme l'expulsion peut être la réaction même à l'événement, elle est signalée et l'utilisateur peut réintégrer le cas avec le motif « critère inadapté à ce cas ».
- Écart très élevé (par exemple +4,5) : il est conservé ; les contrôles de cohérence de 07 ont déjà écarté les feuilles aberrantes, et le test de robustesse montre le poids de ce cas.
- Correction de la date d'un événement par le document 06 : le rattachement est refait, le changement de match mesuré est inscrit dans l'historique du cas et dans l'historique des verdicts.
- Adversaire qui dispute sa première saison et compte moins de 10 matchs : critère du niveau de l'adversaire non évaluable, mentionné sur le cas.
- Type dont tous les cas tombent dans des matchs à fort enjeu, comme le record négatif à éviter (D-34) : tous ses cas sont exclus par défaut et son profil affiche « tous les cas sont exclus pour enjeu inhabituel » (Q-SEN-01).
- Type dont le match mesuré est par nature un match précis, comme le candidat « match contre l'ancienne équipe » : SEN-02 le rattache à ce match ; si le joueur ne le joue pas, voir Q-SEN-04.
- Événement historique dont la plus ancienne source date du jour du match, sans heure : antériorité incertaine, le match mesuré est le suivant que le joueur joue (SEN-44).
- Événement détecté qui porte la marque « datation à vérifier » : son cas attend la décision de l'utilisateur et ne compte pas (SEN-45).
- Joueur retiré ou type retiré : ses profils sont archivés ; les cas valides d'un joueur retiré restent dans les tendances générales (SEN-19).

## Pièges d'interprétation

Cette section s'adresse à l'utilisateur autant qu'au développeur. Elle explique sans formule pourquoi un verdict peut tromper, ce que l'application fait contre chaque piège et ce qu'elle ne peut pas faire.

### Petits échantillons

Un joueur vit peu d'événements de chaque type. Sur quelques matchs, le hasard pèse lourd : un joueur dont le jeu ne dépend en rien des événements obtiendra quand même, sur 5 cas, un écart moyen supérieur à +0,9 ou inférieur à −0,9 environ une fois sur vingt-trois. Un seul match exceptionnel peut porter toute une moyenne, comme le cas C7 de l'exemple.

- Ce qui le limite : le seuil de 5 cas (H-03) ; le bruit attendu, qui grandit quand les cas sont peu nombreux et ne descend jamais sous la variabilité habituelle du joueur (SEN-22) ; la fourchette affichée avec chaque moyenne (SEN-38) ; le test de robustesse (SEN-26) ; la confiance du profil (SEN-25) ; les proportions données en nombres (SEN-39).
- Ce qui reste : ces règles rendent l'incertitude visible, elles ne la suppriment pas. Un verdict « possible » sur 5 à 10 cas reste un indice faible, à confirmer par les cas suivis.

### Retour à la moyenne

Beaucoup d'événements, critiques ou moqueries, suivent un mauvais match. Le match suivant est en général meilleur, simplement parce que le mauvais match devait beaucoup au hasard : comparé au mauvais match, il ressemble à une « réponse ». Autre forme du même piège : les profils les plus frappants sont en partie ceux que le hasard a favorisés, et leurs cas futurs seront en moyenne moins extrêmes, même si l'effet est réel.

- Ce qui le limite : l'application compare au niveau de saison du joueur (D-07), jamais au match précédent (SEN-08), si bien qu'un simple retour à la normale donne un écart voisin de zéro et non un écart positif ; les profils sont jugés sur des cas qui n'ont pas servi à les établir, avec un bilan qui distingue un effet retrouvé mais plus faible qu'annoncé ([10](10-suivi-automatique-et-validation.md)).
- Ce qui reste entier : les périodes de forme. Un joueur en méforme durable est davantage critiqué et le reste au match suivant ; un joueur en pleine forme approche plus souvent d'un record. La référence de saison ne voit pas la forme du moment (Q-SEN-03).

### Multiplication des comparaisons

Plus on examine de couples joueur-type, plus le hasard en fera paraître sensibles. Avec 50 couples évalués et aucun effet réel nulle part, on obtiendrait en moyenne un peu plus de deux verdicts au moins « possibles », et environ une chance sur huit de voir apparaître au moins un faux « probable ». Il en va de même quand l'utilisateur parcourt les profils et retient les plus spectaculaires, et quand il modifie un réglage : chaque essai est une comparaison de plus.

- Ce qui le limite : un seuil plus exigeant pour « probable » que pour « possible » (SEN-23) ; le nombre de faux signaux attendus affiché à côté de la liste des profils (SEN-41) ; la date du dernier changement de paramètre et l'historique des verdicts (SEN-37) ; le jugement des profils sur les cas suivis ([10](10-suivi-automatique-et-validation.md)).
- Ce qui reste : l'application ne corrige pas les verdicts selon le nombre de couples examinés, elle l'affiche (H-SEN-14). L'attention portée aux profils spectaculaires reste un biais entier.

### Contexte de fort enjeu

Un match éliminatoire pousse tous les joueurs à se surpasser. Un événement qui le précède paraîtra avoir produit un effet que l'enjeu suffit à expliquer.

- Ce qui le limite : l'exclusion des matchs du tournoi de qualification et des matchs éliminatoires (SEN-14) ; la comparaison des matchs de phases finales à une référence de phases finales (07) ; l'enjeu signalé par la recherche, la classification ou l'utilisateur.
- Ce qui reste : les enjeux qu'aucune règle ne calcule (rivalité, match très exposé, retrouvailles, fin de contrat) ne sont exclus que s'ils sont signalés. Pour un type qui ne se produit que dans un match à fort enjeu, comme le record négatif à éviter (D-34), l'effet est indiscernable de l'enjeu : ce piège y reste entier (Q-SEN-01).

### Biais des récits de presse

La presse raconte volontiers qu'un joueur « a répondu aux critiques par 40 points » ; elle raconte rarement la critique suivie d'un match ordinaire. Une recherche qui s'appuie sur ces récits trouve surtout les belles histoires, et c'est ainsi que se sont formées les convictions de départ (D-32).

- Ce qui le limite : l'exigence d'exhaustivité du prompt (H-01, [05](05-demande-de-backtest-et-prompt.md)) ; l'obligation de sources publiées avant le match (D-10) ; le comptage de tous les événements quel que soit le résultat (SEN-32, SEN-33) ; les cas suivis, enregistrés avant que le résultat soit connu ([10](10-suivi-automatique-et-validation.md)).
- Ce qui reste : l'application ne peut pas vérifier qu'un backtest est exhaustif. Les profils historiques peuvent rester gonflés par cette sélection ; seul le tableau de validation peut le révéler.

### Décisions prises après avoir vu le résultat

Exclure un cas « parce que le contexte était particulier » après avoir constaté qu'il était mauvais, ou ajuster un seuil jusqu'à voir apparaître un « probable », sont deux façons de se raconter une histoire.

- Ce qui le limite : le motif obligatoire, jamais fondé sur la performance (SEN-17) ; la trace de chaque décision ; l'écart de contrôle et l'avertissement sur les exclusions manuelles (SEN-27) ; l'historique des verdicts (SEN-37) ; le pronostic figé avant le match pour les cas suivis ([10](10-suivi-automatique-et-validation.md)).
- Ce qui reste : l'utilisateur garde la main. L'application rend ces décisions visibles, elle ne les empêche pas.

## Critères d'acceptation

- Étant donné un événement daté du 15 janvier sans heure et des matchs de l'équipe le 15 janvier au soir et le 17 janvier, quand l'application le rattache, alors le match mesuré est celui du 17 janvier.
- Étant donné un événement devenu public à 22 h 10, heure de la côte Est, et un match commencé à 19 h 30 le même jour, quand l'application le rattache, alors ce match ne compte pas et le match mesuré est le suivant que le joueur joue.
- Étant donné un joueur qui manque deux matchs puis joue le troisième six jours après l'événement, quand l'événement est rattaché, alors le match mesuré est ce troisième match et le critère calculé de retour de blessure n'est pas retenu ; étant donné un joueur absent cinq matchs consécutifs qui revient dans le délai, alors le cas est exclu pour retour de blessure.
- Étant donné un événement du 5 juillet dont le premier match suivant a lieu en octobre, quand il est rattaché, alors le cas est non mesurable, motif « aucun match joué dans le délai ».
- Étant donné un joueur à 35 minutes de moyenne qui ne joue que 14 minutes dans le premier match suivant l'événement, quand le cas est évalué, alors il est exclu pour temps de jeu trop faible et n'est pas rattaché au match d'après.
- Étant donné deux événements du même type avant le même match, quand ils sont rattachés, alors ils forment un seul cas, compté une fois ; étant donné deux événements de types différents avant le même match, alors chaque type reçoit un cas marqué « concomitant ».
- Étant donné un match mesuré d'indice 0,751 et une référence, match exclu, de moyenne 0,513 et d'écart-type 0,205, quand l'écart est calculé, alors il vaut 1,16.
- Étant donné un match de phases finales où l'équipe du joueur est menée 2 victoires à 3, quand le cas est évalué, alors il est exclu pour enjeu inhabituel ; étant donné un match de phases finales disputé à une victoire partout, sans enjeu signalé, alors ce critère n'est pas retenu.
- Étant donné un adversaire qui compte 18 victoires et 58 défaites en saison régulière hors match mesuré, quand le cas est évalué, alors il est exclu pour niveau de l'adversaire.
- Étant donné un cas mesuré, quand l'utilisateur veut l'exclure, alors aucun motif lié à la performance n'est proposé et l'exclusion sans motif est refusée ; quand il l'exclut avec le motif « autre facteur parasite » et un commentaire, alors le cas passe à l'état exclu, la décision est tracée et elle survit à un recalcul complet.
- Étant donné les huit écarts valides de l'exemple chiffré, quand le profil est calculé, alors l'écart moyen vaut 0,80, la fourchette va de +0,09 à +1,51, le verdict est « possible, à la hausse », il est fragile et la confiance du profil est faible.
- Étant donné les mêmes écarts de signe opposé, quand le profil est calculé, alors le verdict est « possible, à la baisse », avec la même fourchette au signe près, la même confiance du profil et la même présentation.
- Étant donné 4 cas valides pour un couple joueur-type, quand le profil est affiché, alors il indique « non concluant pour ce joueur (4 cas valides sur 5 nécessaires) » et présente la tendance générale du type sous son propre titre.
- Étant donné 6 cas valides et 4 cas exclus, quand la confiance du profil est calculée, alors la part de cas douteux vaut 40 % et la confiance du profil baisse d'un niveau.
- Étant donné 30 cas valides d'un type apportés par 2 joueurs seulement, quand la tendance générale est calculée, alors son verdict est non concluant.
- Étant donné un profil possible qui deviendrait non concluant si ses deux exclusions manuelles étaient annulées, quand il est affiché, alors l'avertissement « verdict dépendant des exclusions manuelles » apparaît.
- Étant donné un profil quelconque, quand il est affiché, alors le nombre d'événements est égal au nombre de cas plus le nombre d'événements regroupés, et le nombre de cas à la somme des cas en attente, valides, exclus et non mesurables.
- Étant donné une modification du seuil du verdict « possible », quand elle est enregistrée, alors tous les profils sont recalculés, chaque verdict modifié est inscrit dans l'historique avec la cause « changement de paramètre » et la liste des profils affiche la date de ce changement.
- Étant donné 50 couples joueur-type évalués, quand la liste des profils est affichée, alors elle indique qu'environ 2,3 verdicts au moins possibles et 0,1 verdict probable sont attendus du seul hasard.
- Étant donné un profil de 7 cas valides dont 5 au-dessus de zéro, quand il est affiché, alors on lit « 5 cas sur 7 » et non un pourcentage.
- Étant donné un cas de la saison en cours, quand le joueur dispute un nouveau match, alors la référence provisoire, l'écart du cas et le profil sont recalculés, et un changement de verdict éventuel est inscrit avec la cause « référence mise à jour ».
- Étant donné un profil comptant 6 cas historiques et 2 cas suivis valides (lot 2), quand il est affiché, alors la vue par défaut compte 8 cas en précisant leur origine, et la vue « cas historiques seuls » en compte 6.

## Dépendances

- [00 — Vue d'ensemble](00-vue-d-ensemble.md) : glossaire (cas, écart normalisé, profil de sensibilité, tendance générale, verdict, confiance du profil) et états communs des cas.
- [01 — Joueurs suivis](01-joueurs-suivis.md) : profils archivés d'un joueur retiré, dont les cas restent comptés dans les tendances (JOU-19) ; suppression de ses données (JOU-24) ; Q-JOU-01, à laquelle SEN-16 répond par défaut.
- [02 — Taxonomie des événements](02-taxonomie-des-evenements.md) : seuls les types validés ont un profil actif, un type retiré un profil archivé (TAX-31) ; la règle de datation doit pouvoir indiquer qu'un événement est connu à l'avance (SEN-02) ; versions de fiche, requalification, fusion et scission (TAX-24, TAX-25, TAX-27, TAX-29) ; Q-TAX-01 et Q-TAX-02 renvoient à Q-SEN-04 et Q-SEN-01.
- [04 — Détection des événements](04-detection-des-evenements.md) : fournit les événements détectés, leur instant de référence, la marque « datation à vérifier » et leurs indications de contexte ; sa classification reprend les définitions de SEN-13 et SEN-14 ; il écarte et réintègre les événements détectés.
- [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) : le prompt exige l'exhaustivité (H-01), demande l'heure de publication quand elle est connue et reprend les définitions du retour de blessure et de l'enjeu du match (SEN-13, SEN-14) ; couverture (BKT-10) ; confiance de la recherche et Q-BKT-01 (SEN-43).
- [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) : enregistre les événements historiques, classe leur antériorité (IMP-18, SEN-44), détecte les doublons, corrige, supprime ou remplace les événements et leurs indications, tient les refus restants (IMP-24) ; chaque import déclenche SEN-34.
- [07 — Statistiques de match](07-statistiques-de-match.md) : fournit les matchs, la participation, les minutes, le seuil de temps de jeu, les indices, les références, les bilans d'équipe et l'état des séries.
- [09 — Fiche d'alerte](09-fiche-d-alerte.md) : reprend le profil dans sa vue par défaut et applique SEN-31 pour un joueur qui a trop peu de cas.
- [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) : crée les cas suivis, utilise les vues par origine (SEN-21) et les grandeurs de SEN-22.
- [12 — Interface et accès](12-interface-et-acces.md) : écrans des profils, des tendances et des cas, liste « à faire » pour les signalements et les datations à vérifier, saisie des décisions manuelles.
- [13 — Données sensibles](13-donnees-sensibles.md) : retrait d'un événement, qui sort alors du décompte sans autre trace que le compteur global (SEN-33, SEN-48, DSN-29).
- [14 — Exigences transverses](14-exigences-transverses.md) : gestion et traçabilité des paramètres.

## Hypothèses et questions ouvertes

Renvois au journal :

- H-01, H-02, H-03, H-04, H-05, H-09, H-12 et H-13 sont des hypothèses du journal, à confirmer comme telles ; ce document les applique.
- Q-04 : les seuils du verdict ne sont pas fixés ; SEN-23 propose des valeurs par défaut (H-SEN-10).
- Q-05 : le pari reste hors périmètre (SEN-42).

Hypothèses locales, toutes à confirmer :

- H-SEN-01 — Un événement daté sans heure est réputé public à la fin de sa journée, heure de la côte Pacifique (SEN-01).
- H-SEN-02 — Pour un événement connu à l'avance, le match mesuré se détermine par la date locale du match (SEN-02).
- H-SEN-03 — Délai maximal de rattachement de 10 jours (SEN-04).
- H-SEN-04 — Les cas concomitants comptent dans chaque type ; leur exclusion est désactivée par défaut (SEN-06).
- H-SEN-05 — Retour de blessure calculé : l'un des 2 premiers matchs après une absence d'au moins 4 matchs de l'équipe (SEN-13).
- H-SEN-06 — Enjeu inhabituel : tournoi de qualification, matchs éliminatoires et enjeu signalé ; les autres matchs de phases finales ne sont pas retenus (SEN-14).
- H-SEN-07 — Niveau de l'adversaire : moins de 25 % ou plus de 75 % de victoires, repli sur la saison précédente en dessous de 10 matchs (SEN-15).
- H-SEN-08 — Transfert et expulsion sont signalés pour revue, sans exclusion automatique (SEN-16).
- H-SEN-09 — Liste fermée de motifs, sans motif lié à la performance ; les décisions manuelles priment et persistent (SEN-17).
- H-SEN-10 — Dispersion retenue d'au moins 1 ; seuils de 2 et 0,25 pour « possible », de 3 et 0,40 pour « probable » (SEN-22, SEN-23).
- H-SEN-11 — Confiance du profil : 8 et 15 cas, dispersion de 1,5, part de cas douteux de 30 %, baisse en cas de verdict fragile (SEN-25, SEN-26).
- H-SEN-12 — Écart de contrôle et avertissement sur les exclusions manuelles (SEN-27).
- H-SEN-13 — Tendance générale : chaque cas pèse autant, au moins 3 joueurs, baisse de la confiance du profil au-delà de 50 % de cas apportés par un seul joueur (SEN-28, SEN-29).
- H-SEN-14 — Proportions en nombres sous 20 cas ; faux signaux attendus affichés plutôt que verdicts corrigés pour le nombre de comparaisons, couples archivés compris (SEN-39, SEN-41).
- H-SEN-15 — Antériorité incertaine : la source du jour du match, sans heure, est réputée publiée en fin de journée, heure de la côte Pacifique, et le match mesuré est le suivant ; antériorité non établie ou à vérifier : aucun cas compté (SEN-44).
- H-SEN-16 — Un événement historique de confiance de la recherche « faible » est compté comme les autres, et le nombre de tels cas est affiché avec le profil (SEN-43).
- H-SEN-17 — Un événement détecté marqué « datation à vérifier » ne produit aucun cas compté tant que l'utilisateur n'a pas levé la marque ou corrigé la date (SEN-45).

Questions locales :

- Q-SEN-01 — Types indissociables d'un facteur parasite. Question commune : Q-TAX-02 du document 02 y renvoie. Le record négatif à éviter (D-34) se joue presque toujours dans un match à fort enjeu ; l'approche d'un record peut conduire l'équipe à orienter le jeu vers le joueur, ce qu'aucun critère ne repère. Les exclure tous (comportement par défaut pour le premier, par SEN-14) rend le type non mesurable ; les garder confond l'effet et le facteur. Faut-il permettre de désactiver un critère pour un type précis, avec un avertissement permanent sur ses profils, comparer ces cas à des matchs semblables sans événement, par exemple les autres matchs éliminatoires du joueur, ou ajouter un critère propre au type ? En attendant, la règle commune s'applique.
- Q-SEN-02 — La tendance générale doit-elle peser chaque cas (règle actuelle, conforme au glossaire) ou chaque joueur, pour qu'un joueur aux nombreux cas ne la domine pas ?
- Q-SEN-03 — Faut-il compléter la référence de saison (D-07) par une référence de forme récente, pour limiter le piège des périodes de forme ? Ce serait modifier une décision de l'utilisateur.
- Q-SEN-04 — Renvoi vers Q-TAX-01 du [02](02-taxonomie-des-evenements.md), qui porte la question des types connus d'avance : faut-il les repérer dans la presse ou les déduire du calendrier ? Ce qui reste propre au présent document : pour un type dont le match mesuré est par nature un match précis (candidat « match contre l'ancienne équipe »), SEN-02 rattache l'événement à ce match ; si le joueur ne le joue pas, faut-il classer le cas non mesurable plutôt que de le rattacher, comme le fait SEN-02, au premier match joué ensuite, qui n'a plus de lien avec l'événement ? En attendant, SEN-02 s'applique.

Questions des autres documents qui attendent le présent document :

- Q-BKT-01 (05), poids de la confiance de la recherche « faible » : reste ouverte ; par défaut, ces événements comptent et leur nombre est affiché (SEN-43, H-SEN-16).
- Q-IMP-01 (06), antériorité incertaine : réponse par défaut de SEN-44 (H-SEN-15), à confirmer.
- Q-JOU-01 (01), premier match après un changement d'équipe : réponse par défaut de SEN-16 (H-SEN-08), signalement pour revue sans exclusion automatique.
- Q-TAX-02 (02), types liés par construction à un facteur parasite : portée par Q-SEN-01.
- Q-VUE-01 (00), verdicts dus au hasard quand les couples se multiplient : réponse par défaut de SEN-23, SEN-41 et H-SEN-14 ; les seuils ne sont pas corrigés selon le nombre de profils, le nombre de faux signaux attendus est affiché, et les profils confrontés aux cas suivis se distinguent par les vues de SEN-21 et le tableau de validation du document 10.
