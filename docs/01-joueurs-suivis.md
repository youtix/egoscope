# 01 — Joueurs suivis

## Objet

Ce document décrit la liste des joueurs NBA que l'application suit : sur quels critères l'utilisateur les choisit, combien il peut en suivre, comment chacun est identifié pour que la détection et la source de statistiques le retrouvent, et comment la liste évolue (changement d'équipe, blessure longue, fin de carrière, pause, retrait). Il décrit aussi la fiche joueur, point d'entrée vers tout ce que l'application sait d'un joueur, à commencer par son profil de sensibilité.

## Décisions d'origine

- D-03 et D-33 — Un seul sport : la NBA.
- D-17 — Le balayage porte sur une liste restreinte de 20 à 30 joueurs très médiatisés.
- D-31 — L'effet n'est attendu que chez des joueurs talentueux à l'égo sensible ; le backtest sert à repérer ces joueurs.
- D-36 — Les backtests sont demandés au fil des détections, sans lot initial couvrant toute la liste.
- D-02 — Un seul utilisateur, qui choisit seul ses joueurs.
- D-07 bis — Gratuité totale : la taille de la liste pèse sur les quotas des services gratuits.
- D-10 — Les événements doivent être établis par des sources de presse datées.
- D-19 — Le temps de jeu et le retour de blessure font partie des facteurs parasites.
- D-20 — Stockage minimal : l'identité d'un joueur se limite à ce qui sert.
- H-02 — Le match mesuré est le premier match joué après que l'événement est devenu public.
- H-07 — Un événement détecté est suivi même quand le joueur n'a pas de backtest.
- H-11 — La collecte et la classification traitent la presse anglophone et francophone.
- H-12 — Les joueurs suivis font partie du lot 1 ; au lot 1, les demandes de backtest sont déclenchées à la main.
- Q-03 — Les 20 à 30 joueurs ne sont pas désignés.
- Q-07 — Les autres sports et les autres ligues sont hors périmètre.

## Périmètre

Ce document couvre :
- les critères de choix d'un joueur et les indicateurs qui aident ce choix ;
- la taille de la liste et la saisie de la liste initiale ;
- l'identité d'un joueur : nom d'usage, variantes d'écriture, surnoms, équipe actuelle, correspondance avec la source de statistiques ;
- le cycle de vie d'un joueur suivi (actif, en pause, retiré), le changement d'équipe, la blessure longue et la fin de carrière ;
- le sort des données d'un joueur retiré et leur suppression ;
- le contenu de la fiche joueur et de la liste des joueurs.

Il ne couvre pas :
- la recherche des variantes de nom dans les articles et la levée des ambiguïtés : voir [04 — Détection des événements](04-detection-des-evenements.md) ;
- la récupération des feuilles de match, du calendrier, de la référence de saison et du prochain match : voir [07 — Statistiques de match](07-statistiques-de-match.md) ;
- la création et le contenu des demandes de backtest : voir [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) ;
- le calcul des profils et le sort des cas : voir [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) et [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) ;
- l'effacement d'un événement et de ses traces : voir [13 — Données sensibles](13-donnees-sensibles.md) ;
- la présentation des écrans et la navigation : voir [12 — Interface et accès](12-interface-et-acces.md).

## Acteurs et déclencheurs

- **L'utilisateur** ajoute, modifie, met en pause, réactive et retire un joueur et, le cas échéant, supprime ses données. Il est seul juge du choix des joueurs (D-02).
- **L'application** recherche la correspondance d'un joueur dans la source de statistiques, met à jour son équipe, signale les absences prolongées et applique les effets de chaque état.
- **La tâche de statistiques** (07) déclenche la mise à jour de l'équipe, le calcul des absences et la relance des correspondances à établir quand elle récupère de nouvelles feuilles de match.
- **La détection quotidienne** (04, lot 2) consulte la liste des joueurs actifs et leurs variantes de nom.

## Parcours

### Scénario nominal : ajouter un joueur

1. L'utilisateur ouvre l'ajout d'un joueur. L'application rappelle les critères de choix (JOU-01) et indique le nombre de joueurs actifs par rapport au maximum (JOU-04).
2. Il saisit le nom d'usage du joueur et choisit son équipe actuelle parmi les équipes NBA.
3. L'application recherche le joueur dans la source de statistiques et présente les candidats trouvés ; l'utilisateur confirme le bon (JOU-10).
4. L'application affiche, quand la source les fournit, les indicateurs d'aide au choix (JOU-02).
5. L'utilisateur complète les variantes d'écriture et les surnoms, et marque au besoin une variante comme ambiguë ; l'application signale toute variante partagée avec un autre joueur suivi (JOU-09).
6. Il enregistre. Le joueur est créé à l'état actif. Aucune demande de backtest n'est créée (JOU-07).
7. La fiche joueur s'ouvre ; elle indique qu'aucun backtest n'existe encore et propose d'en déclencher un à la main (05).

### Variantes

- **Correspondance introuvable ou source indisponible** : à l'étape 3, le joueur est enregistré avec la mention « correspondance à établir » ; l'application relance la recherche plus tard (JOU-10).
- **Liste pleine** : à l'étape 1, si le maximum de joueurs actifs est atteint, l'ajout est refusé avec une explication (JOU-05).
- **Changement d'équipe** : la tâche de statistiques constate que le joueur a joué pour une autre équipe ; l'application met à jour l'équipe actuelle et garde la trace du changement (JOU-13).
- **Blessure longue** : le joueur manque une série de matchs de son équipe ; l'application le signale et suggère une pause, que l'utilisateur accepte ou non (JOU-21, JOU-22).
- **Pause et reprise** : l'utilisateur met le joueur en pause, puis le réactive (JOU-15 à JOU-18, JOU-20).
- **Fin de carrière ou désintérêt** : l'utilisateur retire le joueur ; ses données restent consultables (JOU-19, JOU-23).
- **Suppression** : pour un joueur retiré, l'utilisateur demande la suppression de toutes ses données (JOU-24).

## Règles de gestion

### Choix des joueurs

- **JOU-01** [Lot 1] — L'écran d'ajout rappelle les critères de choix d'un joueur : évoluer en NBA (D-03) ; avoir du talent, c'est-à-dire être un joueur de premier plan au temps de jeu important et régulier ; être fortement exposé dans la presse, anglophone comme francophone (D-17, H-11). Il en donne les raisons : un joueur peu exposé vit peu d'événements rapportés et datés par la presse (D-10) ; un joueur au temps de jeu réduit produit surtout des cas douteux (D-19) ; l'effet cherché suppose du talent (D-31). Il précise que la sensibilité de l'égo n'est pas un critère d'entrée : c'est ce que le backtest doit révéler (D-31). Ces critères guident l'utilisateur ; l'application ne bloque jamais un ajout en leur nom.
- **JOU-02** [Lot 1] — Dès que la correspondance statistique est confirmée, la fiche joueur affiche, à titre indicatif, le nombre de matchs joués et le temps de jeu moyen du joueur sur la saison en cours, fournis par 07.
- **JOU-03** [Lot 2] — La fiche joueur affiche un indicateur d'exposition : le nombre d'articles collectés qui ont mentionné le joueur au cours des 30 derniers jours (période paramétrable, H-JOU-08). Il se calcule à partir du préfiltrage de la détection (04), sans appel supplémentaire à un service à quota, et reste disponible après la purge des articles ([03 — Collecte des actualités](03-collecte-des-actualites.md)).

### Taille de la liste

- **JOU-04** [Lot 1] — Le nombre de joueurs actifs est plafonné par le paramètre « nombre maximal de joueurs actifs », de valeur par défaut 30, paramétrable (D-17, H-JOU-01). Les joueurs en pause ou retirés n'entrent pas dans ce décompte. Le paramètre « nombre indicatif minimal », de valeur par défaut 20, paramétrable, ne bloque rien : en dessous, la liste « à faire » rappelle que la liste des joueurs est plus courte que la fourchette de D-17.
- **JOU-05** [Lot 1] — Un ajout ou une réactivation qui ferait dépasser le maximum est refusé. Le message indique le maximum en vigueur et les issues possibles : mettre en pause ou retirer un joueur actif, ou relever le paramètre, sachant que davantage de joueurs consomme davantage de quota ([14 — Exigences transverses](14-exigences-transverses.md)).

### Liste initiale

- **JOU-06** [Lot 1] — La liste initiale n'étant pas désignée (Q-03), l'application démarre sans aucun joueur et ne propose aucune liste prédéfinie. Tant qu'aucun joueur n'est suivi, la liste « à faire » (12) invite l'utilisateur à en ajouter.
- **JOU-07** [Lot 1] — L'ajout d'un joueur ne crée aucune demande de backtest, et l'application n'en crée jamais d'office pour toute la liste (D-36). Au lot 1, l'utilisateur déclenche une demande à la main depuis la fiche joueur (H-12) ; au lot 2, une demande naît aussi d'une détection (05).

### Identité

- **JOU-08** [Lot 1] — L'identité d'un joueur suivi comprend : un identifiant attribué par l'application à l'ajout, unique, qui ne change jamais et n'est jamais réattribué, même après une suppression ; c'est lui que portent le prompt et le résultat de recherche (05) ; le nom d'usage, obligatoire, tel que la presse l'écrit le plus souvent ; des variantes d'écriture (avec ou sans accents, translittérations, forme avec ou sans suffixe, prénom seul quand la presse l'emploie) ; des surnoms employés par la presse ; l'équipe actuelle, obligatoire, choisie parmi les équipes NBA ; la correspondance statistique (JOU-10).
- **JOU-09** [Lot 1] — Le nom d'usage, les variantes d'écriture et les surnoms forment les variantes de nom que la détection cherche dans les articles anglophones et francophones (H-11, voir 04). Une variante ne figure qu'une fois pour un même joueur. Une variante identique à celle d'un autre joueur suivi est acceptée, mais signalée à la saisie avec le nom de cet autre joueur. L'utilisateur peut marquer comme ambiguë toute variante qui désigne aussi d'autres personnes ou qui est un mot courant, en particulier une variante partagée ; la détection n'en tient compte qu'accompagnée d'un indice complémentaire (04, DET-04, H-DET-02). Au lot 2, l'ajout ou la réactivation d'un joueur, ou l'ajout d'une variante, fait repasser au préfiltrage les articles récents encore conservés, pour ce seul joueur ou cette seule variante (04, DET-07).
- **JOU-10** [Lot 1] — À l'ajout, l'application recherche le joueur dans la source de statistiques (07) et présente les candidats avec ce qui les distingue (nom, équipe, saisons jouées) ; l'utilisateur en confirme un. Cette correspondance statistique ne peut être liée qu'à un seul joueur suivi, ce qui empêche les doublons. Si aucun candidat ne convient, ou si la source est indisponible ou son quota atteint, le joueur est enregistré avec la mention « correspondance à établir » ; l'application relance la recherche à chaque passage de la tâche de statistiques, présente les nouveaux candidats dans la liste « à faire » et cesse ces recherches dès que l'utilisateur a confirmé un candidat (H-JOU-02). Tant que la correspondance n'est pas confirmée, aucune statistique n'est récupérée pour ce joueur.
- **JOU-11** [Lot 1] — Aucune autre donnée personnelle n'est enregistrée sur un joueur : ni date de naissance, ni photo, ni origine, ni nationalité, ni information sur sa vie privée ou sa santé (D-20, voir 13). Si la question Q-TAX-01 de [02 — Taxonomie des événements](02-taxonomie-des-evenements.md) était tranchée en faveur du calendrier, le seul jour anniversaire et la liste des anciennes équipes devraient s'y ajouter.
- **JOU-12** [Lot 1] — L'utilisateur peut modifier l'identité d'un joueur à tout moment. Quand le nom d'usage change, l'ancien nom est conservé comme variante. Changer la correspondance statistique relance la recherche et la confirmation de JOU-10.

### Équipe actuelle

- **JOU-13** [Lot 1] — Quand la tâche de statistiques constate qu'un joueur suivi a joué un match pour une autre équipe que son équipe actuelle, l'application met à jour l'équipe actuelle, enregistre le changement (date du premier match avec la nouvelle équipe, équipe précédente, origine « constaté ») et l'affiche sur la fiche joueur (H-JOU-03). L'utilisateur peut aussi changer l'équipe à la main, par exemple dès l'annonce d'un échange (origine « saisi ») ; le premier match joué avec la nouvelle équipe confirme ensuite le changement.
- **JOU-14** [Lot 1] — Un changement d'équipe ne modifie aucun événement ni aucun cas existant. Le match mesuré reste le premier match joué par le joueur après l'événement, quelle que soit son équipe (H-02), et le prochain match se lit dans le calendrier de l'équipe actuelle (07). Un match mesuré qui est le premier du joueur avec une nouvelle équipe est signalé pour revue sur le cas, sans exclusion automatique (08, SEN-16).

### États et leurs effets

- **JOU-15** [Lot 1] — Un joueur suivi est dans l'un des états actif, en pause ou retiré. Les transitions permises, toutes à l'initiative de l'utilisateur, sont : d'actif à en pause ou à retiré ; d'en pause à actif ou à retiré ; de retiré à actif. Chaque changement est daté et peut porter un motif facultatif, choisi dans une liste : absence prolongée, fin de carrière, départ de la NBA, exposition insuffisante, autre (H-JOU-06).
- **JOU-16** [Lot 1] — Un joueur actif est soumis à toutes les fonctions : demandes de backtest, récupération des statistiques, calcul de ses profils et, au lot 2, détection quotidienne, alertes et suivi des matchs, y compris tant qu'il n'a pas de backtest (H-07).
- **JOU-17** [Lot 1] — Un joueur en pause garde ses profils, toujours consultables. L'utilisateur peut encore déclencher pour lui une demande de backtest à la main. Ses demandes de backtest à faire restent à faire, et ses cas en attente du match continuent d'être mesurés (07, 08 ; H-JOU-04).
- **JOU-18** [Lot 2] — Un joueur en pause n'est pas soumis à la détection quotidienne : aucun événement détecté, aucune demande de backtest sur détection, aucune fiche d'alerte (04, [09 — Fiche d'alerte](09-fiche-d-alerte.md)). À la reprise, seuls les articles récents encore conservés repassent au préfiltrage pour lui (JOU-09) ; les événements plus anciens survenus pendant la pause ne sont pas rattrapés d'office, et une demande de backtest déclenchée à la main après la reprise permet de les retrouver (H-JOU-04).
- **JOU-19** [Lot 1] — Un joueur retiré ne reçoit plus aucune demande de backtest, ni à la main ni sur détection, et n'est soumis ni à la détection ni aux alertes. Ses demandes encore à faire passent à l'état annulée (05). Ses données sont conservées : identité, événements, cas, profils et, au lot 2, historique des alertes. Ses profils restent consultables, présentés comme archivés, et ses cas valides continuent de compter dans la tendance générale de chaque type (H-JOU-07). Ses cas encore en attente du match sont mesurés s'il rejoue dans le délai de rattachement ; au-delà, ils deviennent non mesurables (08, SEN-04, SEN-47).
- **JOU-20** [Lot 1] — La réactivation d'un joueur en pause ou retiré est soumise au maximum de JOU-04. Elle ne crée aucune demande de backtest ; au lot 2, elle relance le préfiltrage des articles récents pour ce joueur (JOU-09).

### Blessure longue et fin de carrière

- **JOU-21** [Lot 1] — La fiche joueur affiche la date du dernier match joué et le nombre de matchs consécutifs de son équipe qu'il a manqués depuis, d'après 07. La cause d'une absence (blessure, suspension, raison personnelle) n'est jamais enregistrée (13).
- **JOU-22** [Lot 1] — Quand un joueur actif a manqué un nombre de matchs consécutifs de son équipe au moins égal au seuil « absence prolongée », de valeur par défaut 10, paramétrable, la liste « à faire » suggère de le mettre en pause (H-JOU-05). L'application ne change jamais l'état d'elle-même. La suggestion disparaît quand le joueur rejoue ou quand l'utilisateur la refuse ; refusée, elle ne revient qu'après un nouveau match joué suivi d'une nouvelle absence prolongée.
- **JOU-23** [Lot 1] — Une fin de carrière se traduit par le retrait du joueur avec le motif « fin de carrière », avec les effets de JOU-19. Un joueur qui quitte la NBA pour une autre ligue est retiré avec le motif « départ de la NBA » ; ses matchs hors NBA ne sont jamais mesurés (Q-07).

### Suppression des données

- **JOU-24** [Lot 1] — Pour un joueur retiré, et pour lui seulement, l'utilisateur peut demander la suppression de toutes ses données (H-JOU-07). L'application affiche ce qui disparaîtra (nombre d'événements, de cas et de demandes de backtest) et demande une double confirmation. La suppression efface l'identité du joueur, ses demandes de backtest, sa couverture et la trace de ses imports (05, 06), et applique à chacun de ses événements le retrait défini dans 13, qui alimente le compteur des événements retirés. Les tendances générales sont recalculées (08). La suppression est irréversible.

### Fiche joueur et liste des joueurs

- **JOU-25** [Lot 1] — La fiche joueur présente au moins :
  - l'identité et l'état, avec l'historique des changements d'état et d'équipe ;
  - la mention « correspondance à établir », le cas échéant ;
  - l'état du backtest : aucun ; demande à faire, avec l'échéance du prochain match ; importé, avec sa date et les types couverts ; demande complémentaire à faire (05) ; le cas échéant, les refus restants du dernier import (06) ;
  - les indicateurs de JOU-02 et de JOU-21 ;
  - la liste des événements du joueur, avec pour chacun le type, la date de référence, le lien vers la source et l'état du cas ;
  - pour chaque type validé, un résumé du profil : nombre de cas valides, écart normalisé moyen, verdict et confiance du profil (08) ; sous le seuil de cas, la présentation prévue par 08 (SEN-31) ; pour un type que la couverture du joueur ne comprend pas, la mention « type non couvert par le backtest ».
- **JOU-26** [Lot 2] — Au lot 2, la fiche joueur présente en plus : les événements détectés, y compris écartés (04) ; l'historique des fiches d'alerte (09) ; les cas suivis et ce qu'ils disent du profil (10) ; l'indicateur d'exposition (JOU-03).
- **JOU-27** [Lot 1] — La fiche joueur est le point d'entrée vers le profil : depuis le résumé, l'utilisateur ouvre le détail du profil pour un type (08) ; depuis la liste, le détail de chaque événement. Elle porte les actions permises par l'état du joueur : modifier l'identité, mettre en pause, réactiver, retirer, demander un backtest (action « Demander un backtest », 05), supprimer les données. La présentation relève de 12.
- **JOU-28** [Lot 1] — La liste des joueurs suivis montre pour chacun le nom d'usage, l'équipe actuelle, l'état, l'état du backtest et le nombre total de cas valides ; elle se filtre par état. La présentation relève de 12.

## Données manipulées

- **Joueur suivi** : identifiant ; nom d'usage ; variantes d'écriture et surnoms, chacun avec sa marque « ambiguë » éventuelle ; équipe actuelle ; correspondance statistique ou mention « correspondance à établir » ; état ; date d'ajout.
- **Historique des états** : pour chaque changement, la date, l'état de départ, l'état d'arrivée et le motif facultatif.
- **Historique des équipes** : pour chaque changement, la date, l'équipe précédente, la nouvelle équipe et l'origine du changement (constaté par les statistiques ou saisi par l'utilisateur).
- **Indicateurs calculés, jamais saisis** : matchs joués et temps de jeu moyen de la saison, date du dernier match joué, matchs consécutifs manqués (07) ; au lot 2, nombre d'articles mentionnant le joueur sur la période (04).
- **Paramètres** : nombre maximal de joueurs actifs (30), nombre indicatif minimal (20), seuil d'absence prolongée (10 matchs), période de l'indicateur d'exposition (30 jours) ; tous paramétrables (14).
- **Données liées, possédées ailleurs** : demandes de backtest (05), événements (04 et [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md)), cas et profils (08), fiches d'alerte (09), cas suivis (10).

## Cas limites et erreurs

- **Homonymes** : deux joueurs NBA portent le même nom ; la confirmation de la correspondance (JOU-10) les départage à l'aide de l'équipe et des saisons jouées.
- **Joueur déjà suivi** : l'utilisateur confirme une correspondance déjà liée à un joueur suivi ; l'ajout est refusé et l'application ouvre la fiche existante, quel que soit son état.
- **Recrue sans match NBA** : le joueur n'a encore joué aucun match ; il peut être ajouté, mais sa correspondance peut rester à établir et aucune référence de saison n'existe tant qu'il n'a pas joué (07).
- **Variante trop générale** : un surnom est aussi un mot courant ; l'application ne le refuse pas ; l'utilisateur le marque ambigu (JOU-09), et la détection exige alors un indice complémentaire (04, DET-04).
- **Échange juste avant un match mesuré** : le joueur change d'équipe entre l'événement et le match ; le cas n'en est pas modifié, mais il est signalé pour revue (JOU-14 ; 08, SEN-16).
- **Suspension** : un joueur suspendu manque des matchs comme un blessé ; JOU-21 et JOU-22 s'appliquent, sans enregistrer la cause.
- **Retour après une fin de carrière** : l'utilisateur réactive le joueur (JOU-20) ; les données conservées reprennent leur cours.
- **Suppression demandée pour un joueur actif ou en pause** : refusée ; l'application invite à le retirer d'abord (JOU-24).
- **Source de statistiques indisponible lors d'un changement d'équipe** : l'équipe reste inchangée jusqu'au passage suivant de la tâche de statistiques ; l'utilisateur peut la changer à la main.
- **Réactivation au-delà du maximum** : refusée comme un ajout (JOU-05).

## Critères d'acceptation

1. (JOU-01) Étant donné l'écran d'ajout, quand l'utilisateur l'ouvre, alors il lit les critères de choix et la mention que la sensibilité de l'égo n'est pas un critère d'entrée.
2. (JOU-04, JOU-05) Étant donné 30 joueurs actifs et le maximum à sa valeur par défaut, quand l'utilisateur tente d'ajouter un trente et unième joueur, alors l'ajout est refusé et le message propose de mettre en pause ou de retirer un joueur, ou de relever le paramètre.
3. (JOU-04) Étant donné 30 joueurs actifs dont l'utilisateur met un en pause, quand il ajoute un nouveau joueur, alors l'ajout est accepté.
4. (JOU-06) Étant donné une première mise en service, quand l'utilisateur ouvre la liste des joueurs, alors elle est vide et la liste « à faire » l'invite à ajouter des joueurs.
5. (JOU-07) Étant donné l'ajout d'un joueur, quand il est enregistré, alors aucune demande de backtest n'existe pour lui.
6. (JOU-09) Étant donné le joueur A dont une variante de nom est déjà saisie, quand l'utilisateur saisit la même variante pour le joueur B, alors l'application l'accepte en signalant qu'elle est partagée avec le joueur A.
7. (JOU-10) Étant donné une source de statistiques indisponible, quand l'utilisateur ajoute un joueur, alors le joueur est enregistré avec la mention « correspondance à établir », aucune statistique n'est récupérée pour lui, et la recherche reprend au passage suivant de la tâche de statistiques.
8. (JOU-10) Étant donné le joueur A déjà suivi, quand l'utilisateur confirme sa correspondance statistique pour un nouvel ajout, alors l'ajout est refusé et la fiche du joueur A s'ouvre.
9. (JOU-13, JOU-14) Étant donné le joueur A de l'équipe X, quand la tâche de statistiques récupère un match qu'il a joué pour l'équipe Y, alors son équipe actuelle devient Y, le changement est historisé, et aucun cas existant n'est modifié.
10. (JOU-17) Étant donné le joueur A en pause avec un cas en attente du match, quand il joue ce match, alors le cas est mesuré.
11. (JOU-18) Étant donné le joueur A en pause, quand un article le concernant est collecté, alors aucun événement détecté n'est créé pour lui et aucune fiche d'alerte n'est émise.
12. (JOU-19) Étant donné le joueur A avec une demande de backtest à faire, quand l'utilisateur le retire, alors la demande passe à l'état annulée et aucune nouvelle demande ne peut être déclenchée pour lui.
13. (JOU-19) Étant donné le joueur A retiré, quand l'utilisateur consulte la tendance générale d'un type, alors les cas valides du joueur A y sont comptés, et le profil du joueur A est consultable avec la mention « archivé ».
14. (JOU-22) Étant donné le joueur A actif qui a manqué 10 matchs consécutifs de son équipe, quand la tâche de statistiques s'achève, alors la liste « à faire » suggère de le mettre en pause et son état reste actif.
15. (JOU-24) Étant donné le joueur A actif, quand l'utilisateur demande la suppression de ses données, alors la demande est refusée et l'application l'invite à retirer d'abord le joueur.
16. (JOU-24) Étant donné le joueur A retiré, quand l'utilisateur demande la suppression de ses données et la confirme deux fois, alors son identité, ses événements, ses cas et ses demandes disparaissent, le compteur des événements retirés augmente du nombre de ses événements, et les tendances générales sont recalculées.
17. (JOU-08) Étant donné le joueur A dont les données ont été supprimées, quand l'utilisateur l'ajoute de nouveau, alors il reçoit un identifiant différent de l'ancien, et un résultat de recherche qui porte l'ancien identifiant ne se rattache pas à lui d'office.

## Dépendances

- [02 — Taxonomie des événements](02-taxonomie-des-evenements.md) : Q-TAX-01, qui pourrait ajouter le jour anniversaire et les anciennes équipes à l'identité du joueur.
- [04 — Détection des événements](04-detection-des-evenements.md) : emploie les variantes de nom, leur marque « ambiguë » et l'état des joueurs pour le préfiltrage ; reprend le préfiltrage des articles récents à l'ajout ou à la réactivation d'un joueur et à l'ajout d'une variante ; lève les ambiguïtés des variantes partagées ou trop générales ; fournit le décompte d'articles de l'indicateur d'exposition.
- [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) : reçoit le déclenchement manuel depuis la fiche joueur ; emploie l'identifiant du joueur dans le prompt ; respecte les effets des états ; fournit l'état du backtest affiché sur la fiche.
- [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) : refus restants affichés sur la fiche.
- [07 — Statistiques de match](07-statistiques-de-match.md) : fournit la recherche de correspondance, les matchs joués, le temps de jeu, l'équipe constatée, les absences et le prochain match ; sa tâche relance la recherche des correspondances à établir (JOU-10).
- [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) : calcule les profils résumés sur la fiche ; recalcule les tendances après une suppression ; rend non mesurables les cas restés en attente au-delà du délai de rattachement (SEN-04) ; signale le premier match avec une nouvelle équipe (SEN-16).
- [09 — Fiche d'alerte](09-fiche-d-alerte.md) et [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) : historiques présentés sur la fiche au lot 2.
- [12 — Interface et accès](12-interface-et-acces.md) : écrans de liste, d'ajout et de fiche ; liste « à faire ».
- [13 — Données sensibles](13-donnees-sensibles.md) : limite des données d'identité ; retrait de chaque événement lors d'une suppression ; compteur des événements retirés.
- [14 — Exigences transverses](14-exigences-transverses.md) : gestion des paramètres ; quotas.

## Hypothèses et questions ouvertes

Renvois au journal : Q-03 (liste initiale non désignée), d'où une application qui démarre sans joueur ; D-17 (taille de 20 à 30 joueurs), traduite en paramètres ; H-07 et H-12, qui restent à confirmer.

- **H-JOU-01 — Plafond et plancher de la liste (à confirmer).** La fourchette de D-17 devient deux paramètres : un maximum de 30 joueurs actifs, qui bloque, et un minimum indicatif de 20, qui ne bloque pas. Seuls les joueurs actifs comptent, parce que seuls eux sollicitent la détection et ses quotas.
- **H-JOU-02 — Correspondance statistique (à confirmer).** Un joueur peut être enregistré avant que sa correspondance soit établie, pour ne pas bloquer l'utilisateur quand la source est indisponible ; aucune statistique n'est récupérée tant qu'elle ne l'est pas.
- **H-JOU-03 — Équipe mise à jour d'après les statistiques (à confirmer).** La source de statistiques fait foi pour l'équipe d'un joueur ; l'application suit ses constats sans demander de confirmation, et l'utilisateur peut corriger.
- **H-JOU-04 — Effets de la pause (à confirmer).** La pause arrête les entrées nouvelles (détection, demandes sur détection, alertes) mais pas la mesure des cas déjà ouverts ; les événements survenus pendant la pause ne sont pas rattrapés d'office, hormis ceux des articles récents que la reprise fait repasser au préfiltrage (04, H-DET-09).
- **H-JOU-05 — Absence prolongée (à confirmer).** À partir de 10 matchs consécutifs manqués, l'application suggère une pause sans jamais l'imposer : elle ne sait pas pourquoi le joueur est absent et n'a pas à le savoir.
- **H-JOU-06 — Motifs de changement d'état (à confirmer).** Une liste courte de motifs facultatifs, pour que l'historique reste lisible.
- **H-JOU-07 — Sort des données d'un joueur retiré (à confirmer).** Les données sont conservées et les cas valides continuent de compter dans les tendances générales : ils restent des mesures valables, et les retirer ferait dépendre les tendances des choix de l'utilisateur. Ses demandes de backtest encore à faire sont annulées, puisqu'il ne peut plus en recevoir. La suppression n'est ouverte qu'aux joueurs retirés, pour éviter un effacement par mégarde.
- **H-JOU-08 — Indicateur d'exposition (à confirmer).** Il porte sur les 30 derniers jours, période paramétrable.
- **Q-JOU-01 — Premier match après un changement d'équipe.** Un joueur qui vient de changer d'équipe joue dans un contexte nouveau, qui peut peser sur sa performance indépendamment de tout événement. Renvoi : le document 08 y répond par défaut, à confirmer ; la situation est signalée pour revue sur le cas, sans exclusion automatique, et l'utilisateur décide (SEN-16, H-SEN-08). Elle n'est pas ajoutée aux facteurs parasites de D-19.
