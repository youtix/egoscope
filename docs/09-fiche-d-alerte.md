# 09 — Fiche d'alerte

## Objet

Quand un joueur déjà profilé vit un nouvel événement détecté, Egoscope produit une fiche d'alerte : une restitution complète et sourcée qui réunit l'événement et ses sources, la sensibilité passée du joueur à ce type d'événement, la tendance générale du type quand le joueur a trop peu de cas, le prochain match et les réserves qui s'imposent (D-29). La fiche décrit ce qui a été mesuré dans le passé : elle ne prédit pas le match et ne recommande jamais de pari. Elle reçoit ensuite l'issue du match, fournie par le suivi automatique, et reste consultable dans l'historique des alertes. Toute la fonctionnalité appartient au lot 2 (H-12).

## Décisions d'origine

- **D-05** — Le résultat est chiffré et sourcé ; ni alerte brute ni recommandation de pari.
- **D-07 bis** — Gratuité totale : tout service à quota doit prévoir ce qui se passe quand le quota est atteint.
- **D-08** — L'objectif est de détecter une sensibilité, pas de parier.
- **D-10** — Sources datées et vérifiables, pour garantir que l'événement était connu avant le match.
- **D-11** — Tendance générale par type, affinée par joueur dès qu'il a assez de cas, avec un niveau de confiance affiché.
- **D-16** — Écart rapporté à la variabilité du joueur ; trois verdicts : probable, possible, non concluant.
- **D-19** — Les facteurs de contexte (retour de blessure, niveau de l'adversaire, enjeu du match, temps de jeu) permettent d'exclure les cas douteux.
- **D-20** — Presse publique, stockage minimal, aucun détail intime.
- **D-24** — Un événement détecté pour un joueur sans backtest déclenche une demande de recherche approfondie.
- **D-29** — Fiche complète pour un joueur déjà profilé, puis suivi automatique du résultat du match.
- **D-35** — Tableau de validation honnête, sans critère d'arrêt.
- **D-36** — Backtests au fil des détections ; le match peut être joué avant que le backtest soit prêt.
- **H-01** — Tous les événements comptent, y compris ceux suivis d'une contre-performance.
- **H-02** — Le match mesuré est le premier match joué après que l'événement est devenu public.
- **H-03** — Un verdict individuel exige un nombre minimal de cas valides (5, paramètre) ; en dessous, seule la tendance générale du type s'applique.
- **H-04** — La sensibilité négative est mesurée et affichée au même titre que la positive.
- **H-05** — Un backtest couvre les types validés à la date de la demande ; une demande complémentaire peut suivre.
- **H-07** — Un événement détecté sans backtest est enregistré et son match suivi.
- **H-08** — L'utilisateur peut écarter un événement détecté à tort, sans avoir à valider chaque événement avant l'alerte.
- **H-09** — Retour de blessure et enjeu du match sont signalés par la recherche ou la classification, puis corrigeables par l'utilisateur.
- **H-12** — La fiche d'alerte appartient au lot 2.
- **Q-04**, **Q-05** — Seuils du verdict non fixés ; pari hors périmètre.

## Périmètre

Ce document couvre :

- le moment où une fiche est produite, et les cas où elle ne l'est pas ;
- son contenu complet et les formulations interdites ;
- les variantes : profil sous le seuil, profil non concluant, type non couvert par le backtest, plusieurs événements avant le même match, détection tardive ;
- ses mises à jour : nouvel événement, nouvelle source, événement écarté ou réintégré, rattachement corrigé, changement du match attendu ;
- les effets d'un retrait d'événement sur la fiche ;
- sa clôture avec l'issue du match, et l'historique des alertes ;
- un exemple rédigé.

Il ne couvre pas :

- la détection, le rattachement au joueur et au type, la confiance de détection et la décision de déclencher une alerte ou une demande : [04 — Détection des événements](04-detection-des-evenements.md) ;
- la demande de backtest, son échéance et la demande complémentaire : [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) ;
- le calendrier, le prochain match et les feuilles de match : [07 — Statistiques de match](07-statistiques-de-match.md) ;
- le rattachement au match mesuré, l'écart normalisé, les exclusions, le profil, la tendance générale, le verdict et la confiance du profil : [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) ;
- le suivi du match, la qualification du cas et le tableau de validation : [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) ;
- les messages Telegram : [11 — Notifications Telegram](11-notifications-telegram.md) ;
- les écrans de la fiche et de l'historique : [12 — Interface et accès](12-interface-et-acces.md) ;
- la formulation des descriptions et le retrait d'un événement : [13 — Données sensibles](13-donnees-sensibles.md).

## Acteurs et déclencheurs

Acteurs :

- l'application, qui produit, met à jour et clôt la fiche sans intervention humaine ;
- l'utilisateur, qui la lit, le plus souvent sur son téléphone, ouvre les sources et peut écarter un événement.

Déclencheurs :

- la détection quotidienne enregistre un événement détecté pour un joueur profilé (ALE-01) ;
- un résultat de recherche est importé pour un joueur alors qu'un de ses événements détectés attend un match qui n'a pas commencé (ALE-05) ;
- un nouvel événement du même joueur se rattache au même match, ou une nouvelle source s'ajoute à un événement présent ;
- l'utilisateur écarte ou réintègre un événement, corrige son rattachement ou un contexte, ou demande un retrait ;
- le calendrier change, ou le joueur ne joue pas le match prévu ;
- le cas d'un événement de la fiche change d'état dans le suivi automatique.

## Parcours

Scénario nominal :

1. La détection quotidienne repère un événement concernant le joueur A, le rattache à un type validé et l'enregistre à l'état « détecté » (document 04).
2. L'application constate que le joueur A est profilé et récupère le match attendu de l'événement (SUI-03), qui sera en principe son match mesuré (documents 07 et 08).
3. Elle produit la fiche : événement et sources, profil du joueur A pour ce type, tendance générale si nécessaire, match attendu, réserves. Les valeurs chiffrées sont figées à cet instant.
4. La fiche est « ouverte » ; le message d'alerte part sur Telegram (document 11).
5. L'utilisateur ouvre la fiche depuis le message ou depuis l'application, lit les réserves, consulte au besoin les sources et le détail du profil.
6. Le match est joué ; le suivi automatique mesure le cas (document 10). La fiche devient « close » et affiche son issue.
7. La fiche reste dans l'historique des alertes, avec son contenu d'origine et son issue.

Variantes :

- **Joueur non profilé** : pas de fiche ; une demande de backtest naît et l'événement est suivi (ALE-04). Si le résultat de recherche est importé avant le coup d'envoi, la fiche est produite à ce moment (ALE-05).
- **Profil sous le seuil** : la tendance générale du type passe au premier plan (ALE-12).
- **Profil non concluant** : la fiche est produite et le dit sans détour (ALE-13).
- **Type non couvert par le backtest** : fiche portant la mention « type non couvert par le backtest », avec la tendance générale et la demande complémentaire (ALE-14).
- **Second événement avant le même match** : la fiche existante s'enrichit (ALE-20).
- **Détection après le coup d'envoi** : fiche marquée « tardive » (ALE-24).
- **Événement écarté** : fiche annulée ou allégée (ALE-22) ; **rattachement corrigé** : correction inscrite, nouvelle fiche si besoin (ALE-31).
- **Événement retiré** : fiche effacée ou allégée (ALE-30).
- **Match reporté ou joueur absent** : le match attendu est mis à jour (ALE-23).

## Règles de gestion

### Production

- **ALE-01** [Lot 2] — Une fiche d'alerte est produite quand un événement détecté, à l'état « détecté », concerne un joueur profilé, au sens du glossaire du [00](00-vue-d-ensemble.md) : un joueur suivi pour lequel au moins un résultat de recherche a été importé (D-29). La décision de déclencher l'alerte appartient à la détection (DET-38 à DET-40) ; le présent document fixe ce qu'elle produit, selon l'aiguillage commun aux documents 04, 05 et 09 : joueur non profilé, pas de fiche mais une demande de backtest (ALE-04) ; joueur profilé dont la couverture (BKT-10) comprend le type de l'événement, fiche complète ; joueur profilé dont la couverture ne comprend pas ce type, fiche portant la mention « type non couvert par le backtest » et demande complémentaire (ALE-14, BKT-04). Dans les trois cas, l'événement est suivi (document 10). Le contenu dépend ensuite du nombre de cas (ALE-12). Aucune fiche n'est produite pour un joueur en pause ou retiré (JOU-18, JOU-19), ni pour un type qui n'est pas validé (TAX-11, TAX-31).
- **ALE-02** [Lot 2] — La fiche est produite à la fin du passage de détection qui a enregistré l'événement, sans attendre aucune validation de l'utilisateur (H-08).
- **ALE-03** [Lot 2] — Une fiche regroupe les événements détectés d'un même joueur dont le match attendu (SUI-03) est le même au moment de leur détection (H-ALE-02). Un événement n'appartient qu'à une seule fiche ; un nouveau passage de détection ne crée pas de seconde fiche pour un événement déjà traité.
- **ALE-04** [Lot 2] — Pour un joueur non profilé, aucune fiche n'est produite : l'événement donne lieu à une demande de backtest (D-24, document 05), il est enregistré et son match est suivi (H-07). L'écran de la demande montre l'événement qui l'a provoquée et son échéance (BKT-18, IHM-27).
- **ALE-05** [Lot 2] — Quand un résultat de recherche est importé pour un joueur alors qu'un de ses événements détectés attend un match mesuré qui n'a pas commencé, la fiche de cet événement est produite (H-ALE-03). Si le calcul du profil n'est pas terminé, la fiche l'indique et reçoit les valeurs du profil dès qu'elles existent, par une mise à jour datée. Si le coup d'envoi est déjà passé au moment de l'import, aucune fiche n'est produite ; l'événement reste un cas suivi (document 10). Dans tous les cas, le pronostic du cas suivi reste celui du document 10, calculé sur les seuls cas historiques et figé au coup d'envoi (SUI-08 à SUI-10).
- **ALE-06** [Lot 2] — Chaque fiche porte un numéro d'ordre unique, sa date et son heure de production, et l'indication « produite avant le coup d'envoi » ou « tardive » (ALE-24).

### Contenu

- **ALE-07** [Lot 2] — **En-tête** : nom du joueur, équipe au moment de la production, numéro, date et heure de production, état, marque « tardive » le cas échéant, et une phrase de synthèse factuelle : type d'événement, verdict avec son nombre de cas valides (ou, sous le seuil, « non concluant pour ce joueur », SEN-31), date et heure du match attendu.
- **ALE-08** [Lot 2] — **Événement** : pour chaque événement, le type avec un lien vers sa fiche de type (document 02) ; une description factuelle courte, conforme au document 13 ; la date et l'heure auxquelles il est devenu public ; chaque source (média, titre dans sa langue d'origine, date et heure de publication, lien) ; la confiance de détection, note de 0 à 100 (DET-16, DET-24), ou l'origine « utilisateur » pour un événement classé ou repêché à la main (DET-13, DET-49) ; les indications de contexte signalées et leur origine (H-09) ; le délai entre la publication et le coup d'envoi du match attendu.
- **ALE-09** [Lot 2] — **Sensibilité du joueur à ce type** : la fiche reprend tels quels les éléments du profil calculés par le document 08, dans sa vue par défaut (SEN-21) : écart normalisé moyen avec son signe et sa fourchette plausible (SEN-38), nombre de cas valides avec leur répartition entre historiques et suivis, nombre de cas exclus, verdict, sens de l'effet (hausse ou baisse), confiance du profil (SEN-25) avec ses raisons, dont un verdict fragile (SEN-26), avertissements de couverture et de version (SEN-46), seuil de cas par joueur en vigueur et date du calcul. La fiche ne calcule rien elle-même. Un lien mène au détail du profil et à la liste de ses cas (document 12).
- **ALE-10** [Lot 2] — **Sens de l'effet** : il est toujours écrit en toutes lettres. Une sensibilité négative occupe la même place et reçoit la même netteté qu'une sensibilité positive, par exemple : « par le passé, après ce type d'événement, le joueur A a joué en moyenne en dessous de sa moyenne de saison » (H-04).
- **ALE-11** [Lot 2] — **Repère général** : quand le joueur a un verdict individuel, la tendance générale du type figure en une ligne de repère, après son profil (H-ALE-05).
- **ALE-12** [Lot 2] — **Profil sous le seuil** : quand le joueur a moins de cas valides que le seuil de cas par joueur (H-03, paramètre du document 08), voire aucun, la fiche suit SEN-31 : elle écrit « non concluant pour ce joueur (2 cas valides sur 5 nécessaires) » et présente en premier, sous le titre « tendance générale du type, ne décrit pas ce joueur », la tendance générale du type : écart normalisé moyen avec sa fourchette, nombre de cas valides, nombre de joueurs concernés, verdict et confiance du profil (D-11, SEN-28). Les valeurs du joueur, que le document 08 calcule aussi sous le seuil (SEN-31), restent visibles en second, avec la mention « indicatif », leur nombre de cas et leur fourchette (H-ALE-04).
- **ALE-13** [Lot 2] — **Profil non concluant** : la fiche est produite comme les autres. Elle affiche le verdict « non concluant » sans l'atténuer ni l'embellir, avec la phrase « les cas passés ne permettent pas de dire que le joueur A réagit à ce type d'événement ». Le cas sera suivi comme les autres (document 10).
- **ALE-14** [Lot 2] — **Type non couvert** : quand la couverture du joueur (BKT-10) ne comprend pas le type de l'événement, par exemple un type validé après sa demande (H-05), la fiche porte la mention « type non couvert par le backtest » (SEN-46), présente la tendance générale du type comme en ALE-12, montre les éventuels cas suivis du joueur pour ce type (TAX-20) et signale la demande complémentaire née de la détection (BKT-04) ou déjà à faire (BKT-07).
- **ALE-15** [Lot 2] — **Match attendu** : le match attendu de l'événement (SUI-03), c'est-à-dire le premier match de l'équipe du joueur dont le coup d'envoi suit l'instant de référence (STA-27), en général son prochain match (STA-26). Quand l'instant de référence, borne prudente (DET-30), tombe après le coup d'envoi du prochain match, par exemple pour un article daté du jour sans heure, la fiche le dit et montre le match suivant. Elle donne la date et l'heure du coup d'envoi dans le fuseau horaire de l'utilisateur (IHM-14), la date du match aux États-Unis quand elle diffère, l'adversaire, domicile ou extérieur si le calendrier le fournit (STA-26), et le temps restant calculé au moment de l'affichage. Elle précise que ce match sera, sauf absence du joueur, le match mesuré de l'événement (H-02, SEN-03).
- **ALE-16** [Lot 2] — **Réserves** : la fiche affiche en phrases simples chaque réserve qui s'applique, sans jamais en masquer une :
  - petit échantillon : la mesure qui s'applique (profil du joueur ou tendance générale) repose sur moins de cas que le seuil applicable selon le document 08, ou porte une confiance du profil « faible » (SEN-25) ;
  - sens de l'effet, toujours présente et formulée selon le cas (H-04) : « le joueur a tendance à jouer moins bien après ce type d'événement » pour un profil en baisse ; « un effet inverse reste possible et serait compté au même titre » pour un profil en hausse ; « l'effet, s'il existe, peut aller dans les deux sens » sous le seuil ou pour un profil non concluant ;
  - contexte connu avant le match qui pourrait rendre le cas douteux selon le document 08 : match à fort enjeu, par exemple éliminatoire, qui pousse tous les joueurs à se surpasser et peut imiter un effet d'égo ; retour de blessure signalé ; niveau de l'adversaire (D-19) ;
  - plusieurs événements avant le même match : leurs effets ne pourront pas être séparés (ALE-20) ;
  - confiance de détection proche du seuil : la note de 0 à 100 de la détection (DET-16) est inférieure au seuil de détection (DET-24) augmenté d'une marge de vigilance (paramétrable, 10 points, H-ALE-06) : l'événement mérite une vérification et peut être écarté ;
  - datation à vérifier (DET-32) : l'article situe le fait avant sa propre publication et un match a pu se jouer entre-temps ; tant que la marque subsiste, le cas n'est pas compté (SEN-45) ;
  - profil incomplet, ou fondé en partie sur une version antérieure de la fiche du type (SEN-46) ;
  - fiche tardive (ALE-24) ; type non couvert (ALE-14).
- **ALE-17** [Lot 2] — **Mention permanente** : chaque fiche se termine par « Cette fiche décrit des matchs passés. Elle ne prédit pas le prochain match et ne constitue pas une recommandation de pari. »
- **ALE-18** [Lot 2] — **Formulations interdites** : ni cote, ni ligne de bookmaker, ni mise, ni pronostic sur le match à venir, ni conseil de pari, ni phrase au futur sur la performance attendue (« devrait briller »), ni superlatif (D-08, Q-05). Le mot « pronostic » n'apparaît que dans l'issue, après le match, dans les termes du document 10 (pronostic figé, pronostic tardif, sans pronostic). La confiance du profil affichée est celle du document 08 (SEN-25), jamais une confiance à parier.
- **ALE-19** [Lot 2] — **Valeurs figées** : les valeurs du profil et de la tendance générale sont figées au moment où elles entrent dans la fiche. Si le profil change ensuite (nouvel import, recalcul, autre cas mesuré), la fiche n'est pas réécrite : elle signale « profil modifié depuis l'émission » et donne un lien vers le profil actuel. La fiche garde ainsi la trace de ce que l'application affichait réellement avant le match (D-35). La qualification du cas se fait, elle, contre son pronostic figé, calculé par le document 10 sur les seuls cas historiques (SUI-08, SUI-09) : il peut différer des valeurs de la fiche, qui comptent aussi les cas suivis, et l'issue le montre (ALE-27).

### Mises à jour

- **ALE-20** [Lot 2] — **Nouvel événement avant le même match** : une section datée s'ajoute, avec l'événement, son type et le profil du joueur pour ce type, figé à cet instant ; la réserve « plusieurs événements » apparaît. Deux événements du même type figurent dans la même section ; leur décompte en cas relève du document 08. Le message de mise à jour est décrit dans le document 11.
- **ALE-21** [Lot 2] — **Nouvelle source** : une source supplémentaire pour un événement déjà présent (regroupement d'articles, document 04) s'ajoute à la liste, sans autre changement ni message. Si elle est plus ancienne que les autres, la date de référence et le délai avant le coup d'envoi suivent la règle du document 04.
- **ALE-22** [Lot 2] — **Événement écarté** : quand l'utilisateur écarte un événement (H-08, document 04), la fiche passe à l'état « annulée » s'il était son seul événement non écarté ; sinon, l'événement passe dans une rubrique « événement écarté » et la fiche continue. La date et le motif sont conservés ; aucun message n'est envoyé pour cette action de l'utilisateur. Quand l'utilisateur réintègre l'événement (DET-45), la fiche reprend l'état qu'elle aurait eu, avec une trace, sans message. Le retrait relève de ALE-30, la correction d'un rattachement de ALE-31.
- **ALE-23** [Lot 2] — **Changement du match attendu** : quand le match prévu est reporté, avancé ou annulé, ou que le joueur ne le joue pas, le bloc « match attendu » montre le nouveau match connu (SUI-18, STA-28) ; l'ancien reste visible, barré, avec le motif. Un message de mise à jour part si le changement est connu avant le coup d'envoi du nouveau match (document 11). Si aucun match n'est connu, la fiche l'indique et reste ouverte.
- **ALE-24** [Lot 2] — **Fiche tardive** : une fiche produite après le coup d'envoi de son match mesuré, ou dont les valeurs du profil n'entrent qu'après ce coup d'envoi (ALE-05), porte la marque « tardive » et la phrase « connue après le coup d'envoi : cette fiche n'a pas pu être lue avant le match ». Elle est produite tout de même, pour l'historique et la validation. Si le match est déjà mesuré, elle naît directement « close ». Son cas est mesuré et compte dans les profils, mais ne sert jamais de test de l'hypothèse : le tableau de validation le compte à part (SUI-06, SUI-10).
- **ALE-25** [Lot 2] — **Contexte corrigé** : si l'utilisateur corrige une indication de contexte (H-09) avant le match, les réserves sont mises à jour et la correction est tracée ; les valeurs figées du profil ne changent pas.

### Clôture, issue et historique

- **ALE-26** [Lot 2] — **États** : une fiche est « ouverte » tant qu'au moins un de ses événements non écartés a un cas « en attente du match » ; « close » quand tous ces cas sont mesurés, exclus ou non mesurables ; « annulée » quand tous ses événements sont écartés ou réaffectés à un autre joueur (ALE-31). La marque « tardive » s'ajoute à l'état.
- **ALE-27** [Lot 2] — **Issue** : à la clôture, la fiche affiche pour son match mesuré la date et l'adversaire, l'indice de performance du joueur, la référence de saison utilisée, l'écart normalisé obtenu, l'état du cas et son motif s'il est exclu ou non mesurable, la catégorie du cas telle que la définit le document 10 (SUI-22 : confirmé, démenti, neutre ou sans pronostic) avec le rappel qu'un cas isolé ne prouve rien, le pronostic figé contre lequel il a été qualifié et sa source (SUI-09), les mentions « enregistré après le coup d'envoi » ou « pronostic tardif » le cas échéant (SUI-19), et les valeurs du profil après intégration du cas. Ces éléments viennent des documents 08 et 10 ; la fiche ne les recalcule pas.
- **ALE-28** [Lot 2] — **Historique** : toutes les fiches sont conservées, annulées et tardives comprises, avec leur contenu figé, leurs mises à jour datées et leur issue. Aucune fiche n'est supprimée ni réécrite, sauf retrait d'un événement (ALE-30). L'historique se consulte par joueur, par type, par état et par période (écran du document 12).
- **ALE-29** [Lot 2] — **Transmission à la validation** : la fiche met à la disposition du document 10 son état, sa marque « tardive » et ses valeurs figées. Le tableau de validation ne juge pas le cas sur ces valeurs mais sur son pronostic figé (SUI-08 à SUI-11). Une fiche annulée n'apporte aucun cas aux comptes (SUI-16, SUI-17) ; une fiche tardive correspond en général à un cas enregistré après le coup d'envoi ou à pronostic tardif, que le tableau compte à part (SUI-06, SUI-10).
- **ALE-30** [Lot 2] — **Retrait** : quand un événement de la fiche est retiré (DSN-26, DSN-27), la fiche est effacée avec son entrée dans l'historique des alertes si cet événement était son seul événement ; sinon, sa section et toute mention de l'événement sont effacées, sans trace de leur contenu, et les réserves sont recalculées. Le numéro d'une fiche effacée n'est jamais réattribué. Aucun message n'est envoyé ; le sort des messages déjà reçus relève du document 11 (TEL-38).
- **ALE-31** [Lot 2] — **Rattachement corrigé** : un mauvais joueur ou un mauvais type se corrige au lieu de s'écarter (DET-43, DET-47). La fiche déjà émise n'est ni supprimée ni réécrite : la correction est inscrite dans son journal des mises à jour (DET-42). Si la fiche n'a plus d'événement pour ce joueur, elle passe à l'état « annulée », motif « rattachement corrigé » ; pour un changement de type, une section datée s'ajoute avec le profil du nouveau type, comme en ALE-20. L'aiguillage étant réévalué (DET-42), une nouvelle fiche est produite pour le nouveau joueur si ALE-01 s'applique.

## Données manipulées

Une fiche d'alerte porte :

- un numéro, la date et l'heure de production, l'état (ouverte, close, annulée) et la marque « tardive » ;
- le joueur et son équipe au moment de la production ;
- le match attendu (SUI-03 : date, heure, adversaire, domicile ou extérieur) et la trace de ses changements ;
- les événements rattachés, chacun avec son type, sa description factuelle courte, sa date de référence, ses sources (média, titre, date et heure de publication, lien), sa confiance de détection, ses marques (DET-32, DET-33), ses indications de contexte et leur origine, son état (détecté ou écarté) et, s'il est écarté, la date et le motif ;
- pour chaque type présent, l'instantané du profil : écart normalisé moyen et sa fourchette, nombre de cas valides dont historiques et suivis, nombre de cas exclus, verdict, sens, confiance du profil et ses raisons, avertissements (SEN-46), seuil en vigueur, date du calcul ;
- l'instantané de la tendance générale du type : écart normalisé moyen et sa fourchette, nombre de cas valides, nombre de joueurs, verdict, confiance du profil ;
- les réserves affichées ;
- le journal des mises à jour (date, nature, contenu ajouté, corrections de rattachement) ;
- l'issue fournie par le suivi automatique, dont la catégorie du cas et son pronostic figé (ALE-27).

La fiche ne conserve aucun texte d'article ; elle s'en tient à ce que permet le document 13.

### Exemple de fiche (joueur fictif)

Exemple entièrement fictif. Ses chiffres respectent les règles et les valeurs par défaut du document 08 (H-SEN-10, H-SEN-11), elles-mêmes à confirmer (Q-04). Le fuseau de l'utilisateur est ici l'heure de Paris.

> **Fiche d'alerte n° 14 — le joueur A (équipe Y)**
>
> Produite le mardi 17 novembre à 22 h 10, avant le coup d'envoi. État : ouverte.
>
> En bref : événement de type « Humiliation publique ». Profil du joueur A pour ce type : verdict « possible », en hausse, sur 7 cas valides. Match attendu le mercredi 18 novembre à 1 h 30.
>
> **Événement**
>
> - Type : Humiliation publique (voir la fiche de type).
> - Fait : en conférence de presse, l'entraîneur de l'équipe X a mis en doute la capacité du joueur A à décider d'un match.
> - Devenu public le lundi 16 novembre à 23 h 40, soit 25 h 50 avant le coup d'envoi.
> - Sources : un média national, « X coach: A is not a closer », publié le 16 novembre à 23 h 40 (lien) ; un quotidien régional, publié le 17 novembre à 2 h 15 (lien).
> - Confiance de détection : 86 sur 100. Contexte signalé : aucun.
>
> **Sensibilité du joueur A à l'humiliation publique**
>
> - Écart normalisé moyen : +0,83 sur 7 cas valides (5 historiques, 2 suivis), fourchette de +0,07 à +1,59. Cas exclus : 2 (un retour de blessure, un match éliminatoire).
> - Verdict : possible. Sens : hausse — par le passé, après ce type d'événement, le joueur A a joué en moyenne au-dessus de sa moyenne de saison.
> - Confiance du profil : faible (moins de 8 cas valides). Seuil de cas par joueur : 5. Valeurs calculées le 17 novembre à 9 h 05.
> - Repère, tous joueurs : +0,18 sur 61 cas valides (17 joueurs), fourchette de −0,08 à +0,44, verdict « non concluant ».
>
> **Match attendu**
>
> - Mercredi 18 novembre à 1 h 30, heure de Paris (mardi 17 novembre au soir aux États-Unis), contre l'équipe X, à l'extérieur.
> - Dans 3 h 20. Sauf absence du joueur A, ce sera le match mesuré de cet événement.
>
> **Réserves**
>
> - Petit échantillon : 7 cas valides et une confiance du profil faible ; un ou deux matchs peuvent changer le verdict.
> - Sens de l'effet : un effet inverse reste possible ; il serait mesuré et compté au même titre.
>
> **Suivi** : le match sera suivi automatiquement ; son issue s'affichera ici.
>
> *Cette fiche décrit des matchs passés. Elle ne prédit pas le prochain match et ne constitue pas une recommandation de pari.*

Après le match, la même fiche, devenue close, affiche en plus :

> **Issue — fiche close le mercredi 18 novembre à 9 h 10**
>
> - Match mesuré : 18 novembre, contre l'équipe X. Cas suivi, mesuré, enregistré à temps.
> - Indice de performance : 0,74 ; référence de saison, provisoire : moyenne 0,58, écart-type 0,15 ; écart normalisé du match : +1,07, provisoire.
> - Catégorie (document 10) : confirmé, au regard du pronostic figé au coup d'envoi, tiré du profil du joueur sur ses seuls cas historiques : possible, en hausse, +0,95 sur 5 cas. Un cas isolé ne prouve rien.
> - Profil après ce cas : +0,86 sur 8 cas valides (5 historiques, 3 suivis), fourchette de +0,15 à +1,57, verdict « possible », en hausse.

Variante pour un joueur sous le seuil (extrait) :

> **Sensibilité du joueur B au conflit entre joueurs**
>
> - Non concluant pour ce joueur (2 cas valides sur 5 nécessaires).
> - Tendance générale du type, ne décrit pas ce joueur : +0,09 sur 48 cas valides (15 joueurs), fourchette de −0,20 à +0,38, verdict « non concluant », confiance du profil de niveau moyen.
> - Indicatif, joueur B seul : +1,40 sur 2 cas (2 historiques), fourchette de −0,01 à +2,81.
> - Réserves : petit échantillon ; l'effet, s'il existe, peut aller dans les deux sens.

## Cas limites et erreurs

- **Match attendu inconnu** (intersaison, interruption, calendrier indisponible) : la fiche est produite sans ce bloc, avec « match attendu inconnu » et la raison, puis complétée dès que le calendrier le permet (document 07).
- **Source de statistiques indisponible ou quota atteint** au moment de la production : la fiche reprend le dernier profil calculé, daté ; rien n'est estimé ni inventé ; le match attendu est complété plus tard (D-07 bis).
- **Profil pas encore calculé** (import fait, statistiques en cours de récupération) : la fiche porte la mention « profil en cours de calcul » et la tendance générale du type si elle existe ; les valeurs du profil y entrent dès qu'elles existent, par une mise à jour datée, et sont figées à ce moment.
- **Profil en cours de recalcul** : la fiche reprend les dernières valeurs complètes, datées, avec la mention « recalcul en cours ».
- **Aucune mesure pour ce type**, ni individuelle ni générale : la fiche le dit (« aucun cas mesuré pour ce type à ce jour ») ; elle reste utile, car le cas sera suivi.
- **Article daté du jour, sans heure** : la date de référence est, par prudence, la fin de ce jour (COL-21, DET-30) ; si le match du jour commence avant, le match attendu est le suivant (ALE-15).
- **Match éloigné de l'événement** (par exemple en intersaison) : le délai est toujours affiché ; une éventuelle exclusion relève du document 08.
- **Joueur transféré** entre l'événement et le match : la fiche garde l'équipe au moment de la production et montre le match attendu avec la nouvelle équipe (STA-25, SEN-16).
- **Joueur mis en pause ou retiré**, ou **type retiré**, pendant qu'une fiche est ouverte : la fiche reste consultable et le signale ; la suite du suivi relève des documents 01, 02 et 10. Aucune nouvelle fiche n'est produite pour eux (ALE-01).
- **Deux fiches du même joueur rattachées au même match** après un changement de match : elles restent distinctes, se renvoient l'une à l'autre et affichent la réserve « plusieurs événements » (H-ALE-02).
- **Événement rattaché au mauvais joueur ou au mauvais type** : il se corrige au lieu de s'écarter (ALE-31).
- **Événement retiré** : la fiche est effacée ou allégée, sans trace de son contenu (ALE-30).
- **Fiche produite pendant le match** : elle est tardive et reste « ouverte » jusqu'à la mesure.
- **Plusieurs alertes le même jour** pour des joueurs différents : une fiche par joueur et par match ; leur regroupement dans les messages relève du document 11.

## Critères d'acceptation

1. (ALE-01, ALE-02) Étant donné un joueur profilé, quand la détection enregistre pour lui un nouvel événement d'un type couvert par son backtest, alors une fiche d'alerte est produite à la fin du passage, sans action de l'utilisateur.
2. (ALE-04) Étant donné un joueur pour lequel aucun résultat de recherche n'a été importé, quand un événement est détecté pour lui, alors aucune fiche n'est produite, une demande de backtest existe et l'événement est suivi.
3. (ALE-05) Étant donné un événement détecté pour un joueur non profilé dont le match commence dans 10 heures, quand l'utilisateur importe le résultat de recherche de ce joueur avant le coup d'envoi, alors une fiche d'alerte est produite pour cet événement et reçoit les valeurs du profil dès qu'elles sont calculées.
4. (ALE-09) Étant donné une fiche produite, quand on la compare au profil calculé au même instant, alors l'écart moyen et sa fourchette, le nombre de cas valides et sa répartition, le nombre d'exclus, le verdict, le sens et la confiance du profil sont identiques.
5. (ALE-12) Étant donné un joueur ayant 2 cas valides pour ce type et un seuil de 5, quand la fiche est produite, alors elle indique « non concluant pour ce joueur (2 cas valides sur 5 nécessaires) », présente d'abord la tendance générale sous le titre « tendance générale du type, ne décrit pas ce joueur » avec ses nombres de cas et de joueurs, et ne montre l'écart du joueur qu'avec la mention « indicatif », son nombre de cas et sa fourchette.
6. (ALE-13) Étant donné un profil « non concluant » de 9 cas valides, quand le joueur vit un nouvel événement de ce type, alors la fiche est produite avec le verdict « non concluant » et la phrase prévue.
7. (ALE-10, ALE-16) Étant donné un profil dont l'écart moyen est négatif, quand la fiche est produite, alors le mot « baisse » et la phrase sur le jeu en dessous de la moyenne y figurent, ainsi que la réserve sur le sens de l'effet.
8. (ALE-16) Étant donné un match attendu éliminatoire, quand la fiche est produite, alors la réserve de fort enjeu est affichée.
9. (ALE-17, ALE-18) Étant donné n'importe quelle fiche, quand on en lit le texte, alors il ne contient ni cote, ni conseil de pari, ni phrase au futur sur la performance attendue, et se termine par la mention permanente.
10. (ALE-03, ALE-20) Étant donné une fiche ouverte pour le joueur A, quand un événement d'un autre type est détecté pour lui avant le même match, alors la même fiche s'enrichit d'une section datée et de la réserve « plusieurs événements », et aucune seconde fiche n'est créée.
11. (ALE-24) Étant donné un événement devenu public avant un match mais détecté après son coup d'envoi, quand la fiche est produite, alors elle porte la marque « tardive » et la phrase prévue.
12. (ALE-22) Étant donné une fiche ouverte d'un seul événement, quand l'utilisateur écarte cet événement, alors la fiche devient « annulée », reste dans l'historique avec la date et le motif, et aucun message n'est envoyé.
13. (ALE-23) Étant donné une fiche ouverte, quand le match prévu est reporté, alors le bloc « match attendu » montre le nouveau match et garde l'ancien, barré, avec le motif.
14. (ALE-19) Étant donné une fiche produite avec +0,62 sur 7 cas, quand un nouvel import porte le profil à +0,40 sur 9 cas, alors la fiche affiche toujours +0,62 sur 7 cas, signale le changement et mène au profil actuel.
15. (ALE-26, ALE-27) Étant donné une fiche ouverte, quand le suivi automatique mesure le cas, alors la fiche devient « close » et affiche l'issue fournie par le document 10.
16. (ALE-28) Étant donné une fiche close dont l'issue contredit le profil, quand l'utilisateur consulte l'historique, alors elle y figure et aucune action ne permet de la supprimer ou de la modifier, hors retrait (ALE-30).
17. (ALE-01) Étant donné un joueur profilé en pause et un événement détecté qui le concerne, quelle qu'en soit l'origine, quand l'aiguillage a lieu, alors aucune fiche d'alerte n'est produite.
18. (ALE-14) Étant donné un joueur profilé dont la couverture ne comprend pas le type de l'événement, quand la fiche est produite, alors elle porte la mention « type non couvert par le backtest », présente la tendance générale du type et signale la demande complémentaire.
19. (ALE-30) Étant donné une fiche d'un seul événement, quand l'utilisateur retire cet événement, alors la fiche et son entrée dans l'historique des alertes disparaissent ; étant donné une fiche de deux événements, alors seule la section de l'événement retiré disparaît.
20. (ALE-31) Étant donné une fiche du joueur A dont l'unique événement est corrigé pour être rattaché au joueur B, profilé, alors la fiche du joueur A inscrit la correction et devient « annulée », motif « rattachement corrigé », et une fiche est produite pour le joueur B.
21. (ALE-15) Étant donné un article daté du jour sans heure et un match de l'équipe ce soir-là, quand la fiche est produite, alors le match attendu affiché est le match suivant, et la fiche explique pourquoi.
22. (ALE-27) Étant donné une fiche close dont le cas est mesuré, quand l'utilisateur lit l'issue, alors il y trouve la catégorie du cas, le pronostic figé contre lequel il a été qualifié avec sa source, et le rappel qu'un cas isolé ne prouve rien.

## Dépendances

- [00 — Vue d'ensemble](00-vue-d-ensemble.md) : glossaire et objets métier.
- [01 — Joueurs suivis](01-joueurs-suivis.md) : états du joueur ; aucune fiche pour un joueur en pause ou retiré (JOU-18, JOU-19).
- [02 — Taxonomie des événements](02-taxonomie-des-evenements.md) : fiches de type et leur état ; aucune fiche pour un type retiré (TAX-31).
- [04 — Détection des événements](04-detection-des-evenements.md) : création de l'événement détecté, confiance de détection (DET-16, DET-24), marques de datation (DET-32, DET-33), regroupement des sources, écartement et réintégration (DET-43 à DET-45), correction du rattachement (DET-42, DET-47), aiguillage (DET-37 à DET-40), qui emploie la même définition du joueur profilé.
- [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) : demande pour un joueur non profilé, échéance (BKT-18), couverture (BKT-10), demande complémentaire (BKT-04).
- [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) : import qui rend un joueur profilé (ALE-05).
- [07 — Statistiques de match](07-statistiques-de-match.md) : prochain match et liste des matchs (STA-26, STA-27), calendrier, reports, absence du joueur.
- [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) : valeurs du profil dans sa vue par défaut (SEN-21) et sa fourchette (SEN-38), tendance générale et son nombre de joueurs (SEN-28), seuil de cas et libellés sous le seuil (SEN-31), confiance du profil (SEN-25), avertissements (SEN-46), motifs d'exclusion, rattachement au match mesuré (SEN-03), datation à vérifier (SEN-45).
- [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) : match attendu (SUI-03), pronostic figé et catégorie du cas (SUI-08 à SUI-11, SUI-22), cas enregistrés après le coup d'envoi et pronostics tardifs comptés à part (SUI-06, SUI-10).
- [11 — Notifications Telegram](11-notifications-telegram.md) : messages d'alerte et de mise à jour ; sort des messages après un retrait (TEL-38).
- [12 — Interface et accès](12-interface-et-acces.md) : écran de la fiche, historique, fuseau horaire (IHM-14).
- [13 — Données sensibles](13-donnees-sensibles.md) : description factuelle (DSN-19 à DSN-23), retrait d'un événement (DSN-26, DSN-27).
- [90 — Journal des décisions](90-journal-des-decisions.md).

## Hypothèses et questions ouvertes

Renvois au journal :

- **H-01, H-02, H-03, H-04, H-05, H-07, H-08, H-09, H-12** : appliquées telles quelles.
- **Q-04** : les seuils du verdict n'étant pas fixés, la fiche affiche le verdict produit par le document 08 avec les seuils en vigueur.
- **Q-05** : aucune fonction de pari.
- **Limite connue (D-36)** : la première alerte d'un joueur arrivera souvent trop tard ; ALE-05 en réduit l'effet sans le supprimer.

Hypothèses locales :

- **H-ALE-01** — Supprimée, voir la définition du joueur profilé dans le glossaire du [00](00-vue-d-ensemble.md) et la couverture dans le [05](05-demande-de-backtest-et-prompt.md) (BKT-10).
- **H-ALE-02 — Une fiche par joueur et par match** (à confirmer) : les événements d'un même joueur rattachés au même match attendu partagent une fiche, plutôt qu'une fiche par événement ; si deux fiches se retrouvent sur le même match après un changement de calendrier, elles restent distinctes et se renvoient l'une à l'autre.
- **H-ALE-03 — Fiche après import** (à confirmer) : un import fait avant le coup d'envoi du match d'un événement en attente produit la fiche de cet événement.
- **H-ALE-04 — Valeurs indicatives sous le seuil** (à confirmer) : sous le seuil, l'écart individuel, que le document 08 calcule (SEN-31), reste affiché en second, marqué « indicatif », avec son nombre de cas et sa fourchette.
- **H-ALE-05 — Repère général** (à confirmer) : au-dessus du seuil, la tendance générale du type figure en une ligne de repère.
- **H-ALE-06 — Vigilance sur la confiance de détection** (à confirmer) : la réserve s'affiche quand la confiance de détection est inférieure au seuil de détection augmenté de 10 points (paramétrable), sur l'échelle de 0 à 100 du document 04.

Questions locales :

- **Q-ALE-01 — Événements connus après leur match** : requalifiée en renvoi. La règle SUI-06 du [10](10-suivi-automatique-et-validation.md) y répond : un cas enregistré après le coup d'envoi est mesuré et compte dans les profils, mais ne compte jamais comme test de l'hypothèse et figure à part dans le tableau de validation ; la fiche porte la marque « tardive » (ALE-24).
