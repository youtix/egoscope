# 10 — Suivi automatique et validation

## Objet

Quand un événement est détecté pour un joueur suivi, l'application suit automatiquement son match mesuré, enregistre le cas suivi qui en résulte et l'ajoute au profil du joueur (D-29). Les cas suivis sont les seuls qui testent l'hypothèse en conditions réelles, parce qu'ils sont enregistrés avant que le résultat du match soit connu ; ce document fixe les règles qui préservent cette propriété. Il définit enfin le tableau de validation, qui confronte aux cas suivis les profils établis sur les cas historiques, sans jamais rien arrêter (D-35).

## Décisions d'origine

- D-01 — L'hypothèse n'est pas tenue pour acquise : elle se vérifie par les faits.
- D-08 — Le but est de détecter une sensibilité, pas de parier.
- D-10 — Seuls comptent des événements connus avant le match.
- D-15 — La détection des nouveaux événements tourne chaque jour.
- D-24 — Un événement détecté pour un joueur sans backtest déclenche une demande de recherche approfondie.
- D-29 — Après un événement, fiche d'alerte puis suivi automatique du résultat ; chaque nouveau cas enrichit le profil et teste l'hypothèse en conditions réelles.
- D-32 — Les convictions de départ reposent sur des exemples marquants, donc biaisés.
- D-35 — Aucun critère d'arrêt ; un tableau de validation honnête montre les profils confirmés ou démentis par les nouveaux cas.
- D-36 — Les backtests sont demandés au fil des détections ; le match peut être joué avant que le backtest soit prêt.
- H-01 — Tous les événements comptent, quel que soit le résultat du match.
- H-02 — Le match mesuré est le premier match joué après que l'événement est devenu public.
- H-03 — Au moins 5 cas valides pour un verdict par joueur ; en dessous, seule la tendance générale s'applique.
- H-04 — L'effet est mesuré dans les deux sens.
- H-07 — Un événement détecté pour un joueur sans backtest est enregistré et son match suivi ; il devient un cas réel du profil à venir.
- H-08 — L'utilisateur peut écarter un événement détecté à tort, sans avoir à valider chaque événement.
- H-12 — Le suivi automatique et le tableau de validation appartiennent au lot 2.

## Périmètre

Ce document couvre :

- la création d'un cas suivi à partir d'un événement détecté, avec ou sans backtest ;
- la distinction stricte entre cas historiques et cas suivis, et la notion d'enregistrement à temps ;
- le pronostic figé avant le match ;
- le suivi automatique du match mesuré et l'enrichissement du profil ;
- les événements écartés ou retirés, les décisions prises après le coup d'envoi, les matchs reportés et les joueurs absents ;
- le contenu du résultat transmis pour être communiqué à l'utilisateur ;
- la catégorie de chaque cas suivi : confirmé, démenti, neutre ou sans pronostic ;
- le tableau de validation et l'absence de critère d'arrêt.

Il ne couvre pas :

- la détection des événements, leur écartement et leur réintégration par l'utilisateur : [04 — Détection des événements](04-detection-des-evenements.md) ;
- la fiche d'alerte : [09 — Fiche d'alerte](09-fiche-d-alerte.md) ; la demande de backtest et son échéance : [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) ;
- le rattachement, la mesure, les exclusions et le calcul des profils : [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) ;
- les statistiques et le prochain match : [07 — Statistiques de match](07-statistiques-de-match.md) ;
- le texte et l'envoi du message de résultat : [11 — Notifications Telegram](11-notifications-telegram.md) ;
- l'écran du tableau de validation : [12 — Interface et accès](12-interface-et-acces.md) ;
- l'import des résultats de recherche et la reconnaissance des doublons à l'import : [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) ;
- le retrait d'un événement pour raison de confidentialité : [13 — Données sensibles](13-donnees-sensibles.md).

## Acteurs et déclencheurs

Acteurs :

- l'application, qui crée les cas suivis, surveille les matchs, fait mesurer les cas selon le document 08, classe les résultats et tient le tableau à jour ;
- l'utilisateur, qui peut écarter ou réintégrer un événement ([04](04-detection-des-evenements.md)), exclure ou réintégrer un cas ([08](08-sensibilite-et-verdict.md)), reçoit les résultats ([11](11-notifications-telegram.md)) et consulte le tableau ([12](12-interface-et-acces.md)).

Déclencheurs :

- l'enregistrement d'un événement détecté ([04](04-detection-des-evenements.md)) ;
- chaque mise à jour des statistiques ([07](07-statistiques-de-match.md)) ;
- l'import d'un résultat de recherche ([06](06-import-des-resultats-de-recherche.md)), qui peut modifier un pronostic avant le match ou établir un pronostic tardif ;
- un événement écarté, réintégré ou retiré, une décision manuelle sur un cas ;
- une correction de statistiques ou la fin d'une phase ;
- un changement de paramètre.

## Parcours

### Scénario nominal

1. La détection quotidienne ([04](04-detection-des-evenements.md)) enregistre un événement détecté : le joueur A, le type T, l'instant où l'événement est devenu public.
2. L'application crée aussitôt un cas suivi, à l'état « en attente du match », horodaté (SUI-01).
3. Elle affiche le match attendu, c'est-à-dire le premier match de l'équipe après l'instant de référence (SUI-03), et calcule le pronostic à partir des seuls cas historiques (SUI-08).
4. La fiche d'alerte ([09](09-fiche-d-alerte.md)) ou, faute de backtest, la demande de backtest ([05](05-demande-de-backtest-et-prompt.md)) est émise ; ces documents en décrivent le contenu.
5. Jusqu'au coup d'envoi, le pronostic suit les changements du profil historique ; au coup d'envoi du match mesuré, il est figé (SUI-09).
6. Après le match, la mise à jour des statistiques ([07](07-statistiques-de-match.md)) apporte la feuille du joueur ; le document 08 établit le match mesuré, la référence, l'écart normalisé et les éventuels critères de cas douteux (SUI-12).
7. L'application classe le cas : confirmé, démenti, neutre ou sans pronostic (SUI-22).
8. Elle transmet le résultat au document 11, qui en fait un message (SUI-19).
9. Le cas valide entre dans le profil du joueur et dans la tendance générale du type, que le document 08 recalcule (SUI-14).
10. Le tableau de validation est mis à jour (SUI-23 à SUI-28).

### Variantes

- Joueur sans backtest (H-07) : le cas est créé de la même façon ; s'il est sans pronostic au coup d'envoi faute de backtest, son pronostic est établi au premier import suivant et marqué « tardif » (SUI-10).
- Détection après le coup d'envoi : le cas est mesuré et enrichit le profil, mais il est « enregistré après le coup d'envoi » et ne compte pas comme test (SUI-06).
- Joueur absent du match attendu ou match reporté : le cas reste en attente jusqu'au premier match que le joueur joue dans le délai du document 08 ; au-delà, il est non mesurable et ce résultat est communiqué (SUI-18).
- Référence en constitution en début de saison : un résultat indicatif est communiqué, la mesure définitive suit (SUI-20).
- Événement écarté avant ou après le match, ou toute autre décision de l'utilisateur prise après le coup d'envoi (SUI-16, SUI-17).
- Événement retiré pour raison de confidentialité : le cas disparaît du tableau, seul le compteur global des retraits en garde la trace (SUI-30).

## Règles de gestion

### Création du cas suivi

- SUI-01 [Lot 2] — Dès qu'un événement détecté est enregistré pour un joueur suivi et un type validé ([04](04-detection-des-evenements.md)), l'application crée un cas suivi à l'état « en attente du match », sans attendre de validation de l'utilisateur (H-08). Le cas porte son instant de création, qui ne change plus.
- SUI-02 [Lot 2] — Le cas suivi est créé que le joueur ait un backtest ou non (H-07). Sans backtest, il est déjà un cas du profil à venir ; la demande de backtest correspondante relève du document 05.
- SUI-03 [Lot 2] — Le cas affiche son match attendu : le premier match officiel de l'équipe du joueur postérieur à l'instant de référence, fourni par le document 07 (STA-27), avec son heure dans le fuseau de l'utilisateur. Ce match n'est qu'attendu : le match mesuré est établi après coup par le document 08.
- SUI-04 [Lot 2] — Un événement détecté du même type qu'un cas suivi en attente et rattaché au même match rejoint ce cas (SEN-05) ; le cas garde l'instant de création de son premier événement.

### Distinction stricte entre cas historiques et cas suivis

- SUI-05 [Lot 2] — L'origine d'un cas est fixée à sa création et ne change jamais : historique s'il vient d'un résultat de recherche ([06](06-import-des-resultats-de-recherche.md)), suivi s'il vient d'un événement détecté. Un cas historique n'est jamais compté comme un test en conditions réelles, même si son match a été joué après l'import.
- SUI-06 [Lot 2] — Un cas suivi est « enregistré à temps » si son instant de création précède l'instant prévu de début de son match mesuré (H-SUI-01, à confirmer). Seuls les cas enregistrés à temps testent l'hypothèse. Un cas suivi créé après le coup d'envoi, par exemple quand la détection quotidienne passe après le match, est « enregistré après le coup d'envoi », ce qui correspond à la marque « détecté après le coup d'envoi » de l'événement (DET-33) : il est mesuré et enrichit le profil comme les autres, mais le tableau le compte à part et ne l'utilise jamais comme confirmation ou démenti. Sa détection a pu s'appuyer sur des articles postérieurs au match, qui racontent plus volontiers les belles histoires.
- SUI-07 [Lot 2] — Un même événement ne donne qu'un cas, et un cas n'a qu'une origine : le premier enregistrement fixe l'origine (H-SUI-02, à confirmer). Si un résultat de recherche rapporte un événement déjà enregistré comme cas suivi, aucun cas historique n'est créé et le cas reste suivi ; si un événement détecté correspond à un cas historique déjà enregistré, aucun cas suivi n'est créé. La reconnaissance du doublon relève du document 06 à l'import (IMP-27) et du document 04 à la détection (DET-58). Si l'événement détecté a été écarté, le rétablir passe par sa réintégration (DET-45), qui lui garde son origine « suivi », et non par l'ajout d'un événement historique.

### Pronostic figé

- SUI-08 [Lot 2] — Le pronostic d'un cas suivi est calculé à partir des seuls cas historiques (H-SUI-03, à confirmer), selon les deux niveaux de D-11 et H-03. Si le couple joueur-type compte au moins le seuil de cas valides historiques de H-03, le pronostic est le verdict de son profil historique (vue « cas historiques seuls », SEN-21), avec son sens, son écart moyen, son nombre de cas et sa confiance du profil, s'il est possible ou probable ; sinon, le cas est « sans pronostic ». En dessous du seuil, le pronostic est celui de la tendance générale historique du type si elle est possible ou probable ; sinon, le cas est « sans pronostic ». Une tendance générale ne remplace jamais le verdict d'un joueur qui atteint le seuil (SEN-31). La source du pronostic (profil du joueur, tendance générale ou aucune) est enregistrée.
- SUI-09 [Lot 2] — Tant que le match mesuré n'a pas commencé, le pronostic suit les changements du profil historique, par exemple après l'import d'un backtest ; chaque version est horodatée. Le pronostic retenu est la dernière version antérieure à l'instant prévu de début du match mesuré : c'est le « pronostic figé ». Il ne change plus ensuite, quoi qu'il arrive au profil historique (nouvel import, exclusion, réintégration, changement de paramètre).
- SUI-10 [Lot 2] — Si le cas est sans pronostic au coup d'envoi du match mesuré parce qu'aucun profil historique n'existait encore pour le joueur, faute d'import ou parce qu'aucun des cas historiques importés n'était encore mesuré (ALE-05, STA-41), son pronostic est calculé selon SUI-08 dès que ce profil existe, sans ce cas, puis figé et marqué « tardif » (H-SUI-04, à confirmer) ; en attendant, le cas est compté sans pronostic. Un cas à pronostic tardif est comptabilisé à part dans le tableau de validation, car ce pronostic a été établi alors que le résultat du cas était déjà connu. Un pronostic tiré de la tendance générale et figé au coup d'envoi n'est jamais remplacé par un pronostic tardif.
- SUI-11 [Lot 2] — Un profil n'est jamais jugé sur les cas qui ont servi à l'établir : le pronostic d'un cas suivi ne contient ni ce cas ni aucun autre cas suivi, et le tableau de validation ne compte jamais un cas historique comme une confirmation ou un démenti. Les cas historiques établissent les profils ; les cas suivis les mettent à l'épreuve.

### Suivi et mesure

- SUI-12 [Lot 2] — Après chaque mise à jour des statistiques ([07](07-statistiques-de-match.md)), l'application examine tous les cas suivis en attente et fait établir par le document 08 leur match mesuré et leur mesure. Aucune action de l'utilisateur n'est nécessaire : de la fiche d'alerte au tableau de validation, les étapes s'enchaînent seules (VUE-10).
- SUI-13 [Lot 2] — Un cas suivi est rattaché, mesuré et éventuellement exclu exactement selon les mêmes règles qu'un cas historique ([08](08-sensibilite-et-verdict.md)) ; il n'existe aucune règle propre aux cas suivis, pour que les deux familles restent comparables.
- SUI-14 [Lot 2] — Un cas suivi valide entre dans le profil du joueur (vue par défaut) et dans la tendance générale du type, qui sont recalculés (D-29, SEN-35), y compris s'il a été enregistré après le coup d'envoi ou s'il est sans pronostic.
- SUI-15 [Lot 2] — Pour un match de la saison en cours, l'écart est d'abord provisoire (STA-21) ; il est recalculé jusqu'à devenir définitif, et la catégorie du cas suit. Le tableau indique le nombre de cas dont l'écart est encore provisoire.

### Événements écartés, matchs reportés, joueur absent

- SUI-16 [Lot 2] — Si l'événement est écarté ([04](04-detection-des-evenements.md)) avant le coup d'envoi du match mesuré, le cas sort de tous les calculs et n'apparaît pas dans le tableau ; la trace reste sur l'événement écarté. Réintégré avant le coup d'envoi (DET-45), il reprend son suivi comme s'il n'avait jamais été écarté.
- SUI-17 [Lot 2] — Toute décision de l'utilisateur prise après le coup d'envoi du match mesuré qui fait sortir un cas suivi des comptes, l'y fait entrer ou change son match mesuré est datée (H-SUI-07, à confirmer) : écartement ou réintégration de l'événement (DET-45, DET-46) ; exclusion ou réintégration manuelle du cas (SEN-17) ; correction d'une indication de contexte, de la date de référence, du joueur ou du type (DET-47, DET-48) ; levée de la marque « datation à vérifier » (SEN-45). Le cas suit la décision dans les calculs, mais ne sert plus jamais de confirmation ni de démenti : le tableau affiche pour chaque ligne le nombre de ces cas, en séparant ceux qui sortent des comptes et ceux qui y entrent, et leur écart moyen dans le sens du pronostic. Un tri fait après avoir vu le résultat reste ainsi visible.
- SUI-18 [Lot 2] — Si le match attendu est reporté ou si le joueur n'y joue pas, le cas reste en attente : le match attendu affiché devient le suivant, et le match mesuré est le premier que le joueur joue dans le délai de SEN-04. Au-delà de ce délai, le cas est non mesurable et ce résultat est communiqué (SUI-19).

### Résultat communiqué

- SUI-19 [Lot 2] — Quand un cas suivi quitte l'état « en attente du match », l'application transmet au document 11 un résultat de match suivi qui contient : le joueur, le type, l'événement et sa source ; le match mesuré (date, adversaire) ; les minutes et l'indice ; la référence utilisée et son caractère provisoire ou définitif ; l'écart normalisé ; le pronostic figé et sa source ; la catégorie ; le nouvel état du profil (nombre de cas valides, écart moyen et sa fourchette, verdict, confiance du profil) et le fait que le verdict ait changé ou non. Pour un cas exclu ou non mesurable, le motif remplace la mesure. Le résultat précise le cas échéant « enregistré après le coup d'envoi, ne compte pas comme test » ou « pronostic tardif ».
- SUI-20 [Lot 2] — Si la référence est encore en constitution (STA-22, STA-23), le résultat est communiqué avec l'indice et la comparaison indicative avec la saison précédente, présentée comme telle ; le cas reste en attente et sa mesure définitive le met à jour dans l'application.
- SUI-21 [Lot 2] — Si, après la communication, une correction de statistiques, une mise à jour de la référence ou une décision manuelle change l'écart ou la catégorie, le cas le montre avec son historique et le tableau utilise la valeur à jour, une décision de l'utilisateur relevant en outre de SUI-17 ; l'envoi éventuel d'un message relève du document 11 (TEL-13).

### Catégorie d'un cas suivi

- SUI-22 [Lot 2] — L'écart dans le sens du pronostic est égal à l'écart normalisé si le pronostic est à la hausse, et à son opposé s'il est à la baisse (H-04). Un cas valide avec pronostic est (H-SUI-05, à confirmer) :
  - confirmé si cet écart atteint +0,25 (paramétrable) ;
  - démenti s'il vaut −0,25 ou moins ;
  - neutre entre les deux.
  Un cas valide sans pronostic est classé « sans pronostic ». Si aucun effet n'existait, on attendrait à peu près autant de démentis que de confirmations (environ 40 % chacun) et 20 % de neutres : un cas isolé ne prouve donc rien.

### Tableau de validation

- SUI-23 [Lot 2] — Le tableau de validation (D-35) comporte une ligne par type validé (tous joueurs confondus), une ligne par joueur (tous types confondus), une ligne par couple joueur-type ayant au moins un cas suivi, et une ligne d'ensemble regroupant tous les cas suivis avec pronostic. Un cas concomitant figure dans la ligne de chacun de ses types, marqué comme tel.
- SUI-24 [Lot 2] — Chaque ligne montre, pour ses cas suivis valides enregistrés à temps, hors pronostics tardifs et hors cas touchés par une décision prise après le coup d'envoi (SUI-17) :
  - les comptes : cas avec pronostic, confirmés, démentis, neutres et cas sans pronostic, avec à côté ce que le hasard seul donnerait (à peu près autant de démentis que de confirmations) ;
  - pour les cas avec pronostic : l'écart moyen dans le sens du pronostic, avec son nombre de cas et sa fourchette (SEN-22), et l'écart annoncé, c'est-à-dire la moyenne des écarts moyens de leurs pronostics figés, pris dans le sens du pronostic ;
  - pour tous ces cas, avec ou sans pronostic : leur écart normalisé moyen comparé à l'écart moyen actuel des cas historiques valides de la même ligne, chacun avec son nombre de cas et sa fourchette ;
  - le bilan (SUI-26, SUI-27).
- SUI-25 [Lot 2] — Chaque ligne montre à part, sans les mêler aux comptes précédents : les cas à pronostic tardif, avec les mêmes informations et leur propre bilan ; les cas enregistrés après le coup d'envoi ; les cas suivis exclus, non mesurables ou encore en attente ; les cas touchés par une décision prise après le coup d'envoi (SUI-17) ; le nombre de cas à écart provisoire. Le tableau indique aussi la date du dernier changement de paramètre.
- SUI-26 [Lot 2] — Le bilan d'une ligne n'est calculé que si elle compte au moins 10 cas suivis avec pronostic (paramétrable, H-SUI-06, à confirmer). En dessous, le tableau affiche « trop peu de cas suivis pour conclure (k sur 10) », avec les nombres et la fourchette, mais aucun bilan. Les proportions suivent SEN-39.
- SUI-27 [Lot 2] — Le bilan d'une ligne se calcule sur les écarts dans le sens du pronostic, avec le bruit attendu défini en SEN-22 (H-SUI-06, à confirmer) :
  - « confirmé » si l'écart moyen dans le sens du pronostic atteint 2 fois le bruit attendu, et si l'écart annoncé ne le dépasse pas de 2 fois le bruit attendu ou plus ;
  - « confirmé, effet plus faible qu'annoncé » si l'écart moyen atteint 2 fois le bruit attendu mais que l'écart annoncé le dépasse d'au moins 2 fois le bruit attendu ;
  - « démenti » si l'écart moyen n'atteint pas 2 fois le bruit attendu et que l'écart annoncé le dépasse d'au moins 2 fois le bruit attendu : l'effet annoncé n'est pas retrouvé ;
  - « indécis » dans tous les autres cas.
- SUI-28 [Lot 2] — Le tableau rappelle trois règles de lecture : même si l'effet est réel, l'écart des cas suivis sera en général plus faible que l'écart annoncé, car les profils retenus sont en partie ceux que le hasard a favorisés ; avec de nombreuses lignes, certaines paraîtront confirmées par hasard ; la ligne d'ensemble est la première à réunir assez de cas pour dire quelque chose. La ligne d'ensemble détaille ses cas selon la source et le niveau du pronostic (profil probable, profil possible, tendance générale), chacun avec son bilan s'il atteint le minimum de SUI-26.

### Absence de critère d'arrêt

- SUI-29 [Lot 2] — Le tableau informe et n'arrête rien (D-35). Aucun bilan, quel qu'il soit, ne suspend la détection, ne change le statut d'un joueur ou d'un type, ne modifie un verdict ou un paramètre, ne supprime de donnée ni ne propose d'abandonner. Aucun seuil d'abandon n'existe. Le tableau ne sert pas au calcul des profils (08) ; toute révision des seuils à sa lumière relèverait d'une décision explicite de l'utilisateur (Q-SUI-01).

### Retrait d'un événement

- SUI-30 [Lot 2] — Quand un événement détecté est retiré pour raison de confidentialité (DSN-26, DSN-27), son cas suivi est effacé avec ses versions de pronostic, sa catégorie et son résultat transmis ; il disparaît de toutes les lignes du tableau, comptes à part compris, et le tableau est recalculé sans lui. Le tableau affiche en tête le compteur global des événements retirés depuis la mise en service, sans joueur, sans type ni date (DSN-29), pour que des retraits ne puissent pas embellir un bilan sans laisser de trace. L'écartement, lui, n'efface rien (SUI-16, SUI-17).

## Données manipulées

- Cas suivi, en complément de la description du cas donnée par le document 08 : instant de création ; enregistré à temps ou après le coup d'envoi ; match attendu ; versions horodatées du pronostic ; pronostic figé (source : profil du joueur, tendance générale ou aucune ; niveau ; sens ; écart moyen annoncé ; nombre de cas ; confiance ; tardif ou non ; instant de figement) ; écart dans le sens du pronostic ; catégorie et son historique ; résultat transmis (date, contenu) ; décisions prises après le coup d'envoi (nature, instant, effet : sortie, entrée ou changement de match mesuré).
- Ligne du tableau de validation : périmètre (type, joueur, couple joueur-type, ensemble ou sous-ligne de l'ensemble) ; comptes par catégorie et comptes attendus du hasard ; écart moyen observé, nombre de cas et fourchette ; écart annoncé ; écart moyen historique actuel ; bilan ; comptes à part ; nombre de cas à écart provisoire ; dates du calcul et du dernier changement de paramètre ; compteur global des événements retirés (DSN-29).
- Paramètres de ce document, avec leur valeur par défaut : seuil de catégorie (0,25) ; nombre minimal de cas suivis pour un bilan (10). Le seuil de 2 fois le bruit attendu reprend celui du verdict « possible » du document 08.

## Cas limites et erreurs

- Événement détecté pendant le match mesuré, entre le coup d'envoi et la fin : le cas est enregistré après le coup d'envoi.
- Événement détecté pendant l'intersaison : le cas est créé, devient non mesurable à l'expiration du délai de SEN-04, et ce résultat est communiqué.
- Backtest importé pendant le match mesuré, alors qu'aucun n'existait au coup d'envoi et que le cas était sans pronostic : le pronostic est tardif.
- Profil historique modifié entre la création du cas et le coup d'envoi : seule compte la dernière version antérieure au coup d'envoi.
- Deux cas suivis de types différents mesurés par le même match : chacun a son pronostic et sa catégorie, et figure dans la ligne de son type, marqué concomitant.
- Source de statistiques en panne après le match : le cas reste en attente avec le motif « statistiques en attente » ; ces feuilles sont servies en priorité dès le retour de la source (07) ; le résultat est communiqué à ce moment.
- Paramètre modifié après le match : le cas est mesuré de nouveau avec les nouveaux paramètres et sa catégorie peut changer, mais son pronostic figé ne change pas ; le tableau affiche la date du changement.
- Joueur mis en pause ou retiré de la liste ([01](01-joueurs-suivis.md)) après la création du cas : le suivi de ce cas continue jusqu'à sa mesure, car tout événement enregistré doit être compté (H-01).
- Événement retiré pour raison de confidentialité ([13](13-donnees-sensibles.md)) : le cas disparaît selon SUI-30 et le tableau est recalculé sans lui.
- Événement écarté avant le match par erreur, puis réintégré après avoir vu le résultat : le cas rentre dans le profil, mais il est compté à part et ne teste rien (SUI-17).
- Joueur dont le profil historique atteint le seuil avec un verdict non concluant : le cas est sans pronostic, même si la tendance générale du type est possible (SUI-08).
- Détection rattrapée plusieurs jours après une panne : les cas créés après le coup d'envoi de leur match sont enregistrés après le coup d'envoi.

## Critères d'acceptation

- Étant donné un article publié à 11 h, heure de la côte Est, détecté à 17 h, et un match de l'équipe à 19 h 30 le même jour, quand la détection enregistre l'événement, alors un cas suivi est créé à 17 h, à l'état « en attente du match », enregistré à temps, avec ce match comme match attendu.
- Étant donné le même article, mais une détection qui passe à 2 h le lendemain, heure de la côte Est, quand le cas est créé, alors il est « enregistré après le coup d'envoi » : il est mesuré et entre dans le profil, mais il n'est compté ni comme confirmation ni comme démenti.
- Étant donné un joueur sans backtest et une tendance générale du type non concluante, quand un événement est détecté, alors un cas suivi est créé, sans pronostic ; quand le backtest est importé après le match mesuré, alors le pronostic est calculé sans ce cas, figé et marqué tardif, et le cas passe dans la partie « pronostic tardif » du tableau.
- Étant donné un joueur sans backtest et une tendance générale « possible, à la hausse » au coup d'envoi, quand le backtest est importé après le match, alors le pronostic figé reste celui de la tendance et aucun pronostic tardif n'est calculé.
- Étant donné un profil historique non concluant à la création du cas, quand un backtest importé avant le coup d'envoi le fait passer à « possible, à la hausse, +0,85 », alors le pronostic figé est « possible, à la hausse, +0,85 » et il n'est pas tardif.
- Étant donné un joueur dont le profil historique compte 9 cas valides et un verdict non concluant, et une tendance générale historique « possible, à la hausse », quand un cas suivi est créé pour lui, alors il est sans pronostic ; étant donné un joueur qui n'a que 3 cas valides historiques, alors le pronostic est celui de la tendance générale.
- Étant donné un backtest importé avant le coup d'envoi dont aucun cas n'est encore mesuré au coup d'envoi, faute de statistiques, et une tendance générale non concluante, quand les cas historiques sont mesurés après le match, alors le pronostic est calculé sans le cas suivi, figé et marqué tardif.
- Étant donné un pronostic figé « possible, à la hausse, +0,85 », quand l'utilisateur exclut après le match deux cas historiques et que le profil historique devient non concluant, alors le cas reste jugé contre « possible, à la hausse, +0,85 ».
- Étant donné un cas suivi mesuré et valide, quand les profils sont recalculés, alors il figure dans la vue par défaut du profil et dans la tendance générale, mais ni dans la vue « cas historiques seuls » ni dans aucun pronostic.
- Étant donné un pronostic à la baisse, quand le cas suivi obtient un écart de −0,40, alors son écart dans le sens du pronostic vaut +0,40 et il est confirmé ; quand il obtient +0,10, alors il est neutre ; étant donné un pronostic à la hausse et un écart de −0,30, alors le cas est démenti.
- Étant donné un joueur absent du match attendu qui joue trois jours plus tard, quand ce match est terminé, alors c'est lui le match mesuré et le cas reste enregistré à temps ; étant donné un joueur qui ne joue aucun match dans les 10 jours, alors le cas est non mesurable et le résultat transmis en donne le motif.
- Étant donné un match attendu reporté, quand le calendrier est mis à jour, alors le match attendu affiché devient le suivant et le cas reste en attente.
- Étant donné un événement écarté avant le match, quand le tableau est calculé, alors le cas n'y apparaît pas ; étant donné un événement écarté après le match, alors le cas sort des calculs, mais sa ligne affiche un cas écarté après le match et son écart dans le sens du pronostic.
- Étant donné un événement écarté avant le coup d'envoi puis réintégré après le match, quand le tableau est calculé, alors le cas entre dans le profil, figure parmi les cas entrés dans les comptes après le coup d'envoi et ne compte ni comme confirmation ni comme démenti.
- Étant donné un cas suivi dont l'événement est retiré, quand le tableau est recalculé, alors le cas n'apparaît dans aucune ligne ni dans aucun compte à part, et le compteur global des événements retirés augmente d'une unité.
- Étant donné un cas suivi existant, quand un résultat de recherche rapporte le même événement, alors aucun cas historique n'est créé et le cas reste suivi.
- Étant donné un couple joueur-type ayant trois cas suivis dont les écarts dans le sens du pronostic valent +0,9 ; −0,4 et +0,7, quand le tableau est affiché, alors la ligne indique 2 confirmés et 1 démenti, un écart moyen de +0,40 avec une fourchette de −0,75 à +1,55, et « trop peu de cas suivis pour conclure (3 sur 10) ».
- Étant donné une ligne d'ensemble de 12 cas suivis dont les écarts dans le sens du pronostic valent +0,9 ; −0,3 ; +0,4 ; +1,2 ; −0,8 ; +0,1 ; +0,6 ; −0,2 ; +0,5 ; +0,3 ; −0,6 et +0,7, et un écart annoncé de +0,95, quand le bilan est calculé, alors on compte 7 confirmés, 3 démentis et 2 neutres ; l'écart moyen vaut +0,23 ; la dispersion (0,61) est retenue à 1, d'où un bruit attendu de 0,289 ; l'écart moyen n'atteint pas 2 fois ce bruit (0,58) ; l'écart annoncé le dépasse de 0,72, soit environ 2,5 fois le bruit ; le bilan est « démenti » : malgré 7 confirmations sur 12, l'effet annoncé n'est pas retrouvé.
- Étant donné un bilan « démenti » sur toutes les lignes, quand le tableau est mis à jour, alors la détection continue, aucun statut de joueur ou de type ne change, aucun verdict ni paramètre n'est modifié et aucun message ne propose d'arrêter.
- Étant donné un cas suivi de la saison en cours d'écart provisoire +0,30, donc confirmé, quand la référence provisoire est mise à jour et que l'écart devient +0,20, alors le cas devient neutre, son historique le montre et le tableau est recalculé.
- Étant donné une référence en constitution au moment du match, quand le résultat est transmis, alors il contient l'indice et la comparaison indicative présentée comme telle, et le cas reste en attente jusqu'à sa mesure.

## Dépendances

- [00 — Vue d'ensemble](00-vue-d-ensemble.md) : glossaire (cas historique, cas suivi, tableau de validation) et états communs.
- [01 — Joueurs suivis](01-joueurs-suivis.md) : statuts du joueur ; un cas déjà créé reste suivi après une mise en pause ou un retrait.
- [04 — Détection des événements](04-detection-des-evenements.md) : fournit l'événement détecté, son instant de référence et ses marques (DET-32, DET-33), reconnaît un événement déjà connu, y compris comme historique (DET-58), permet de l'écarter et de le réintégrer, et date chaque écartement (DET-46) ; l'heure du balayage quotidien détermine la part des cas enregistrés à temps (Q-SUI-02).
- [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) : demande émise pour un joueur sans backtest ; son résultat, une fois importé, peut établir le pronostic avant le match ou un pronostic tardif.
- [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) : reconnaît un événement déjà enregistré comme cas suivi (SUI-07) ; chaque import peut créer une nouvelle version de pronostic.
- [07 — Statistiques de match](07-statistiques-de-match.md) : match attendu, mise à jour quotidienne, références provisoires, comparaison indicative, priorité des cas suivis quand le quota manque.
- [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) : rattachement, mesure, exclusions, datation à vérifier (SEN-45), vues par origine, seuil de H-03 et SEN-31, bruit attendu, recalcul des profils.
- [09 — Fiche d'alerte](09-fiche-d-alerte.md) : émise au moment de la détection pour un joueur profilé ; elle ne modifie pas le pronostic, et son issue affiche la catégorie et le pronostic figé du cas.
- [11 — Notifications Telegram](11-notifications-telegram.md) : transforme le résultat de SUI-19 en message « résultat d'un match suivi ».
- [12 — Interface et accès](12-interface-et-acces.md) : écrans du tableau de validation et des cas suivis.
- [13 — Données sensibles](13-donnees-sensibles.md) : retrait d'un événement et compteur global des retraits (DSN-27, DSN-29, SUI-30).
- [14 — Exigences transverses](14-exigences-transverses.md) : planification des traitements, journalisation, paramètres.

## Hypothèses et questions ouvertes

Renvois au journal :

- H-01, H-02, H-03, H-04, H-07, H-08 et H-12 sont des hypothèses du journal, à confirmer comme telles ; ce document les applique.
- D-35 : aucun critère d'arrêt n'est défini, conformément à la décision de l'utilisateur.

Hypothèses locales, toutes à confirmer :

- H-SUI-01 — Un cas suivi est enregistré à temps s'il a été créé avant l'instant prévu de début de son match mesuré (SUI-06).
- H-SUI-02 — Le premier enregistrement d'un événement fixe l'origine de son cas (SUI-07).
- H-SUI-03 — Le pronostic se calcule sur les seuls cas historiques et se fige au coup d'envoi du match mesuré : verdict historique du joueur s'il atteint le seuil de H-03, tendance générale historique sinon (SUI-08, SUI-09). Une variante consisterait à inclure aussi les cas suivis plus anciens, chaque cas restant jugé sur des cas antérieurs à lui ; elle n'est pas retenue, pour garder une séparation stricte entre les cas qui établissent un profil et ceux qui le testent.
- H-SUI-04 — Un cas sans pronostic au coup d'envoi faute de profil historique reçoit son pronostic dès que ce profil existe, marqué tardif et compté à part (SUI-10).
- H-SUI-05 — Seuil de catégorie de 0,25 dans le sens du pronostic (SUI-22).
- H-SUI-06 — Au moins 10 cas suivis avec pronostic pour un bilan ; bilan fondé sur 2 fois le bruit attendu (SUI-26, SUI-27).
- H-SUI-07 — Toute décision de l'utilisateur prise après le coup d'envoi qui fait sortir un cas suivi des comptes, l'y fait entrer ou change son match mesuré est dénombrée à part et ne teste rien (SUI-17).

Questions locales :

- Q-SUI-01 — Le tableau de validation doit-il un jour servir à réviser les seuils du verdict (Q-04), par exemple si les profils « probables » ne font pas mieux que les « possibles » ? Si oui, uniquement par une décision explicite de l'utilisateur, jamais automatiquement (D-35).
- Q-SUI-02 — L'heure du balayage quotidien (D-15) détermine la part des cas enregistrés à temps : un balayage qui passe après les matchs du soir en Amérique du Nord classe « enregistrés après le coup d'envoi » la plupart des cas dont le match a lieu le jour de la publication. Faut-il programmer la détection avant ces matchs, voire deux fois par jour ? À trancher avec les documents [03](03-collecte-des-actualites.md) et [04](04-detection-des-evenements.md), sous réserve des quotas.
