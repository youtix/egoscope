# 04 — Détection des événements

## Objet

La détection examine chaque article collecté ([03 — Collecte des actualités](03-collecte-des-actualites.md)) pour savoir s'il rapporte un événement susceptible de toucher l'égo d'un joueur suivi. Elle met d'abord de côté, sans consommer de quota, les articles qui ne citent aucun joueur suivi, puis fait classer les autres par un modèle de langage à palier gratuit, à partir des seules fiches de types validés. Elle regroupe les articles qui rapportent le même fait, reconnaît un fait déjà rapporté par un backtest, date l'événement à sa première publication connue et l'aiguille vers le suivi, la demande de backtest ou la fiche d'alerte. L'utilisateur peut écarter ou corriger tout ce qu'elle produit, et chaque événement reste relié aux articles qui l'ont fait naître.

## Décisions d'origine

Source : [90 — Journal des décisions](90-journal-des-decisions.md).

- D-05 — Résultat sourcé : chaque événement garde les articles qui l'établissent.
- D-06 — Les types d'événements sont nets et datables.
- D-07 bis — Gratuité totale : le modèle de langage est utilisé dans les limites de son palier gratuit.
- D-10 — Sources datées : il faut pouvoir établir que l'événement était connu avant le match.
- D-12 — L'IA propose, l'utilisateur valide : seuls les types validés servent à classer ; un fait d'un genre nouveau devient une proposition.
- D-15 — La détection tourne chaque jour.
- D-17 — Liste restreinte de 20 à 30 joueurs : c'est elle qui rend le préfiltrage possible.
- D-20 — Stockage minimal, aucun détail intime.
- D-24 — Une recherche quotidienne par une IA gratuite détecte les événements ; sans backtest du joueur, l'application demande une recherche approfondie.
- D-26 — Flux collectés, puis classés par un modèle de langage à palier gratuit.
- D-29 — Joueur déjà profilé : fiche d'alerte complète, puis suivi automatique du match.
- D-36 — Les backtests sont demandés au fil des détections ; le match peut être joué avant que le backtest soit prêt.
- H-01 — Comptage exhaustif : tous les événements comptent, y compris ceux suivis d'une contre-performance.
- H-02 — Le match mesuré est le premier match joué après que l'événement est devenu public.
- H-05 — Un backtest couvre les types validés à la date de la demande ; une demande complémentaire peut suivre.
- H-07 — Un événement détecté est suivi même si le joueur n'a pas encore de backtest.
- H-08 — L'utilisateur peut écarter un événement détecté à tort, sans valider chaque événement au préalable.
- H-09 — Le retour de blessure et l'enjeu du match peuvent être signalés par la classification, puis corrigés par l'utilisateur.
- H-11 — Les articles sont en anglais ou en français ; l'interface est en français.
- H-12 — La détection appartient au lot 2.

## Périmètre

La détection couvre :

- le préfiltrage des articles par les noms des joueurs suivis ;
- la file d'attente, l'ordre de passage et le comportement face au quota du modèle ;
- la classification, le rattachement à un joueur et à un type, la confiance de détection et son seuil ;
- le regroupement des articles qui rapportent le même fait et la date de référence de l'événement ;
- la reconnaissance, au moment de la détection, d'un fait déjà rapporté par un backtest ;
- la transmission des propositions de type ;
- l'aiguillage de chaque événement après sa création ;
- l'écartement, les corrections, le repêchage et la traçabilité.

Elle ne couvre pas :

- la collecte, la datation et la conservation des articles : [03 — Collecte des actualités](03-collecte-des-actualites.md) ;
- les noms, variantes, surnoms et états des joueurs : [01 — Joueurs suivis](01-joueurs-suivis.md) ;
- les fiches de type, leur cycle de vie et le traitement des propositions : [02 — Taxonomie des événements](02-taxonomie-des-evenements.md) ;
- la couverture des backtests, la création et le contenu d'une demande de backtest : [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) ;
- la règle de correspondance entre événements et la reconnaissance, à l'import, d'un événement historique qui double un événement détecté : [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) ;
- le prochain match d'un joueur et les coups d'envoi : [07 — Statistiques de match](07-statistiques-de-match.md) ;
- le rattachement d'un événement à son match mesuré, les cas douteux et le recalcul : [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) ;
- le contenu de la fiche d'alerte : [09 — Fiche d'alerte](09-fiche-d-alerte.md) ;
- le suivi du match et le tableau de validation : [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) ;
- les messages envoyés : [11 — Notifications Telegram](11-notifications-telegram.md) ;
- les écrans : [12 — Interface et accès](12-interface-et-acces.md) ;
- le retrait d'un événement pour protéger la vie privée et ce qui ne doit jamais être stocké : [13 — Données sensibles](13-donnees-sensibles.md) ;
- les règles générales de quotas, de tâches planifiées et de réglages : [14 — Exigences transverses](14-exigences-transverses.md).

## Acteurs et déclencheurs

- **La tâche planifiée de collecte** : la détection s'enchaîne à la fin de chaque collecte (D-26).
- **La tâche de reprise** : elle relance la file d'attente tant que celle-ci n'est pas vide.
- **Le modèle de langage** : service externe à palier gratuit, soumis à un quota.
- **L'utilisateur** : il écarte, réintègre, corrige, repêche, demande une nouvelle classification ou classe lui-même un article.
- **La taxonomie** (document 02) : la décision sur une proposition de type issue de la détection déclenche le reclassement des articles liés.
- **La liste de suivi** (document 01) : l'ajout ou la réactivation d'un joueur, ou l'ajout d'une variante de nom, déclenche un nouveau préfiltrage des articles récents.

## Parcours

### Scénario nominal

1. La collecte transmet les nouveaux articles à l'état « à analyser ».
2. Le préfiltrage cherche dans le titre et l'extrait de chaque article les noms, variantes et surnoms des joueurs suivis actifs. Un article qui n'en cite aucun devient « non pertinent », sans appel au modèle.
3. Un article qui cite au moins un joueur suivi passe « en attente de classification », avec la liste des joueurs reconnus, et entre dans la file d'attente.
4. Dans l'ordre de priorité de la file et dans la limite du quota, chaque article est soumis au modèle avec les fiches des types validés, la liste « à ne pas reproposer » et les événements récents, détectés ou historiques, des joueurs reconnus.
5. Pour chaque joueur reconnu, le modèle indique les faits rapportés : aucun fait, un fait relevant d'un type validé, ou un fait qui touche l'égo sans relever d'aucun type validé.
6. Pour un fait relevant d'un type validé, avec une confiance de détection au moins égale au seuil, l'article est rattaché à l'événement détecté existant qui rapporte ce fait ; sinon, à moins que le fait ne soit déjà rapporté par un backtest, un nouvel événement est créé à l'état « détecté », daté de la publication de l'article.
7. Chaque nouvel événement est aiguillé : il est confié au suivi, puis, selon que le joueur est profilé et que la couverture de son backtest inclut le type, donne lieu à un besoin de backtest, à une demande de fiche d'alerte, ou aux deux (DET-38 à DET-40).
8. Le journal de détection consigne le sort de chaque article et les compteurs de l'exécution.

### Variantes

- **A — Quota atteint ou modèle indisponible.** Les articles restent en file d'attente ; un incident est ouvert ; la file reprend dès que possible, dans l'ordre de priorité ; l'utilisateur peut classer lui-même un article en attente.
- **B — Fait déjà connu.** L'article est rattaché à l'événement existant ; si sa publication est plus ancienne, la date de référence de l'événement avance.
- **C — Fait sans type validé.** Aucun événement n'est créé ; une proposition de type est transmise au document 02, ou une occurrence est ajoutée à une entrée de la liste « à ne pas reproposer », et l'article passe « lié à une proposition » tant qu'une décision est attendue.
- **D — Confiance de détection insuffisante.** L'article devient « non pertinent » avec le motif « sous le seuil » ; la réponse du modèle reste visible pour un éventuel repêchage.
- **E — Écartement.** L'utilisateur écarte un événement détecté à tort ; l'événement et son cas sortent de tous les calculs.
- **F — Correction.** L'utilisateur change le type, le joueur ou la date de référence, fusionne deux événements ou détache un article.
- **G — Repêchage.** L'utilisateur crée un événement à partir d'un article jugé non pertinent.
- **H — Décision sur une proposition.** Si le type proposé est validé, les articles liés sont reclassés ; s'il est rejeté, ils deviennent non pertinents.
- **I — Nouveau joueur ou nouvelle variante.** Les articles récents encore conservés repassent au préfiltrage pour ce seul joueur ou cette seule variante.
- **J — Détection tardive.** L'événement est créé alors que le coup d'envoi de son match mesuré est déjà passé ; il est marqué comme tel.
- **K — Fait déjà rapporté par un backtest.** Aucun événement détecté n'est créé ; l'article devient « non pertinent » avec le motif « déjà rapporté par un backtest » (DET-58).

## Règles de gestion

### Préfiltrage

- **DET-01** [Lot 2] — Tout article à analyser est préfiltré avant tout appel au modèle. Le préfiltrage ne consomme aucun quota (D-07 bis).
- **DET-02** [Lot 2] — Le préfiltrage porte sur les joueurs suivis à l'état actif (document 01, JOU-16, JOU-18 ; H-DET-01) et sur les noms, variantes et surnoms que leur fiche définit (document 01).
- **DET-03** [Lot 2] — La recherche porte sur le titre et l'extrait. Elle ne tient compte ni de la casse, ni des accents, ni de la ponctuation, et reconnaît les formes usuelles comme le possessif anglais ou l'élision française. Un nom n'est reconnu que comme mot entier : un surnom court n'est pas reconnu à l'intérieur d'un autre mot.
- **DET-04** [Lot 2] — Une variante que la fiche du joueur signale comme ambiguë (homonyme courant, mot usuel) ne suffit pas seule : elle doit être accompagnée, dans le même article, d'une autre variante du même joueur ou du nom de son équipe (H-DET-02). Une variante que partagent plusieurs joueurs suivis (document 01, JOU-09) fait reconnaître chacun d'eux, sauf si l'article contient une autre variante ou le nom de l'équipe de l'un d'eux seulement, auquel cas seul celui-ci est reconnu ; le modèle désigne ensuite le joueur que le fait touche (DET-17).
- **DET-05** [Lot 2] — En cas de doute, le préfiltrage retient l'article : un article retenu à tort coûte un appel au modèle, un article non retenu à tort fait manquer un événement (H-01).
- **DET-06** [Lot 2] — Un article qui ne cite aucun joueur suivi devient « non pertinent » avec le motif « aucun joueur suivi ». Les autres passent « en attente de classification » avec la liste des joueurs reconnus.
- **DET-07** [Lot 2] — Quand un joueur est ajouté ou réactivé, ou qu'une variante de nom est ajoutée, les articles encore conservés dont l'instant retenu ne dépasse pas l'ancienneté maximale de la collecte (document 03) repassent au préfiltrage pour ce seul joueur ou cette seule variante (H-DET-09).
- **DET-57** [Lot 2] — **Décompte d'exposition.** Le préfiltrage compte, pour chaque joueur suivi et chaque jour, au sens du fuseau de l'utilisateur, les articles collectés qui l'ont cité. Ce décompte, réduit à des nombres, survit à la purge des articles (document 03) et alimente l'indicateur d'exposition de la fiche joueur (document 01, JOU-03) sans aucun appel au modèle.

### File d'attente et quota

- **DET-08** [Lot 2] — Le modèle n'est appelé que dans les limites de quota déclarées dans les réglages (document 14). Quand la limite est atteinte, ou que le service refuse ou ne répond pas, les articles restent « en attente de classification » ; aucun n'est perdu, quelle que soit la durée de l'attente (H-01).
- **DET-09** [Lot 2] — La file d'attente est traitée dans cet ordre : d'abord les demandes de l'utilisateur et les reclassements ; puis les articles qui concernent un joueur dont le prochain match commence dans un horizon paramétrable (par défaut 48 heures, H-DET-05), le coup d'envoi le plus proche en premier ; puis les autres articles, du plus anciennement publié au plus récent. Si le prochain match d'un joueur est inconnu (document 07), ses articles sont ordonnés selon leur instant de publication retenu.
- **DET-10** [Lot 2] — La file reprend automatiquement : à chaque passage de la tâche de reprise (par défaut toutes les 6 heures tant que la file n'est pas vide, H-DET-05) et, au plus tard, à l'exécution quotidienne suivante.
- **DET-11** [Lot 2] — Quand le quota interrompt le traitement, un incident « quota atteint » est ouvert (documents 11 et 14). Il indique le nombre d'articles en attente, le joueur concerné dont le match est le plus proche et le moment prévu de la reprise. Il est clos quand la file est vide.
- **DET-12** [Lot 2] — Un même article n'est soumis qu'une fois au modèle, sauf demande de l'utilisateur (DET-50) ou reclassement prévu par les règles DET-07 et DET-36. La conception technique peut soumettre plusieurs articles dans un même appel, à condition que chacun reçoive un résultat distinct et traçable.
- **DET-13** [Lot 2] — L'utilisateur peut classer lui-même un article en attente : il indique, pour chaque joueur reconnu, un type validé ou l'absence d'événement. Ce classement suit les mêmes règles que celui du modèle et porte l'origine « utilisateur ». Il permet de continuer quand le modèle est longtemps indisponible.

### Classification

- **DET-14** [Lot 2] — Le modèle reçoit, pour un article : le titre, l'extrait, le média, l'instant de publication retenu, les joueurs reconnus et leurs noms, les fiches des types validés, transmises en entier dans leur version en vigueur (document 02, TAX-33), la liste « à ne pas reproposer », réduite au nom et à la définition des propositions en attente, des types rejetés et des types retirés (TAX-18), et, pour chaque joueur reconnu, ses événements détectés, écartés compris, et ses événements historiques dont la date de référence se situe dans la fenêtre de regroupement (DET-29). Il ne reçoit que ces données, toutes publiques (document 13, DSN-05).
- **DET-15** [Lot 2] — Seuls les types à l'état validé servent à classer (D-12). Un type proposé, rejeté ou retiré ne peut jamais donner naissance à un événement.
- **DET-16** [Lot 2] — Pour chaque joueur reconnu, le modèle rend la liste, éventuellement vide, des faits que l'article rapporte. Pour un fait relevant d'un type validé, il indique : l'identifiant du type ; une confiance de détection de 0 à 100 ; une description factuelle ; s'il s'agit d'un fait nouveau ou de l'un des événements récents qui lui ont été fournis ; une éventuelle indication d'antériorité (DET-32) ; les indications de contexte que l'article mentionne pour le prochain match du joueur (H-09), avec les valeurs fixées par le document 05 (retour de blessure : oui, non ou inconnu ; enjeu du match : fort, normal ou inconnu) et selon les définitions du document 08 (SEN-13, SEN-14), « inconnu » quand l'article n'en dit rien ; une justification d'une phrase qui cite le critère de la fiche satisfait. Pour un fait qui touche l'égo sans relever d'aucun type validé, il indique soit l'entrée de la liste « à ne pas reproposer » à laquelle le fait correspond, soit un nom et une définition de type suggérés, et dans les deux cas une justification. Un article pour lequel aucun fait n'est rapporté, pour aucun des joueurs reconnus, devient « non pertinent » avec le motif « aucun fait ».
- **DET-17** [Lot 2] — Le joueur rattaché est celui que le fait touche, pas seulement celui que l'article cite. Un fait qui touche deux joueurs suivis donne un événement pour chacun.
- **DET-18** [Lot 2] — Un fait qui touche une équipe entière sans viser personnellement le joueur ne crée pas d'événement : les événements d'équipe sont hors du périmètre de la première version (Q-06).
- **DET-19** [Lot 2] — La classification juge le fait, jamais la performance qui l'a suivi. Toute mention de cette performance (score, statistiques, « réponse sur le terrain ») est ignorée pour décider s'il existe un événement et de quel type. Sans cette règle, la détection retiendrait de préférence les histoires qui ont bien fini (H-01).
- **DET-20** [Lot 2] — Un article qui revient, sans élément nouveau, sur un fait rendu public avant le début de la fenêtre de regroupement ne crée pas d'événement : il devient « non pertinent » avec le motif « fait ancien » (H-DET-10). Un fait ancien révélé pour la première fois est en revanche un fait nouveau, daté de sa publication. Les faits passés relèvent du backtest (document 05).
- **DET-21** [Lot 2] — La description suit les règles de formulation du document 13 (DSN-19 à DSN-23) : elle dit qui, quoi et quand, sans jugement sur la personnalité ou l'état d'esprit du joueur, sans détail de santé ni détail intime. Elle est rédigée en français quelle que soit la langue de l'article (H-11) et ne dépasse pas la longueur maximale d'une description fixée par le document 13 (DSN-20). La justification et la définition suggérée obéissent aux mêmes règles. Comme l'exige le document 13 (DSN-24, DSN-25), l'application contrôle d'elle-même la longueur de ces textes et l'absence de guillemets ; un texte qui échoue n'est jamais enregistré ni envoyé. La description est alors remplacée par une description type, formée du nom du type, du média et de la date de l'article de référence, et l'événement porte la mention « description à revoir », que l'utilisateur lève en la corrigeant (DET-47) ; une justification ou une définition suggérée non conforme est remplacée par la mention « texte non conservé ». L'article n'est pas soumis de nouveau pour ce seul motif, afin de ne pas consommer de quota (H-DET-03).
- **DET-22** [Lot 2] — Une réponse qui cite un joueur non reconnu par le préfiltrage, ou un type non validé ailleurs que comme entrée de la liste « à ne pas reproposer » (DET-34), ou qui omet un élément obligatoire, est inexploitable pour la partie concernée. L'article est soumis de nouveau, jusqu'à un nombre de tentatives paramétrable (par défaut 2, H-DET-03) ; ensuite, il reste en attente avec la marque « classification en échec », et l'utilisateur peut demander une nouvelle tentative ou le classer lui-même.
- **DET-23** [Lot 2] — Le texte des instructions données au modèle est consultable par l'utilisateur. Il n'est pas modifiable depuis l'application ; il évolue avec les versions de l'application (H-DET-03).

### Confiance de détection et seuil

- **DET-24** [Lot 2] — Un fait dont la confiance de détection atteint le seuil de détection (paramétrable, par défaut 70 sur 100, H-DET-03) donne lieu à un événement détecté ou à un rattachement. En dessous, l'article devient « non pertinent » avec le motif « sous le seuil », et la réponse du modèle (type, confiance de détection, justification) reste consultable pendant toute la conservation de l'article, pour un éventuel repêchage. Un événement dont la confiance de détection dépasse à peine ce seuil est créé et aiguillé normalement ; la fiche d'alerte le signale comme à vérifier selon la marge de vigilance que fixe le document 09 (ALE-16, H-ALE-06).
- **DET-25** [Lot 2] — La confiance de détection est une auto-évaluation du modèle, pas une probabilité ; l'interface la présente comme telle et ne la confond ni avec la confiance de la recherche (document 05) ni avec la confiance du profil (document 08). Pour aider l'utilisateur à régler le seuil, l'application montre, sur la période qu'il choisit, la part d'événements écartés par tranche de confiance de détection.
- **DET-26** [Lot 2] — Un changement de seuil ne vaut que pour les classifications suivantes ; il ne remet en cause aucun événement existant. Cette règle empêche d'ajuster le seuil après coup pour ne garder que les événements suivis d'un bon match (H-01, H-DET-03).

### Regroupement et date de référence

- **DET-27** [Lot 2] — Un événement correspond à un fait pour un joueur. Les articles qui rapportent le même fait pour le même joueur sont regroupés dans un seul événement. Un fait qui semble relever de deux types validés n'en reçoit qu'un, celui dont la fiche lui correspond le mieux (document 02, TAX-06), comme dans le prompt de recherche (document 05, H-BKT-06).
- **DET-28** [Lot 2] — Quand le modèle désigne l'un des événements détectés récents qui lui ont été fournis, l'article y est rattaché, sans que le type de l'événement change ; quand il désigne un événement historique, DET-58 s'applique. Quand le classement vient de l'utilisateur, l'application propose le rattachement aux événements du même joueur et du même type situés dans la fenêtre de regroupement ; l'utilisateur confirme ou crée un nouvel événement.
- **DET-29** [Lot 2] — La fenêtre de regroupement est paramétrable (par défaut les 72 heures qui précèdent l'instant retenu de l'article, H-DET-04). Un événement plus ancien n'est pas proposé au regroupement.
- **DET-30** [Lot 2] — La **date de référence** d'un événement est le plus ancien des instants de publication retenus de ses articles, avec la précision de cet instant (document 03). C'est l'instant auquel l'événement était, de façon sûre, public. L'article qui la fournit est l'**article de référence**.
- **DET-31** [Lot 2] — Quand un article rattaché plus tard a un instant retenu plus ancien, la date de référence avance d'elle-même, et le document 08 revoit le match mesuré. Elle ne recule jamais d'elle-même : elle ne peut reculer que si l'utilisateur détache l'article de référence (DET-47).
- **DET-32** [Lot 2] — **Indication d'antériorité.** Quand l'article situe le fait avant sa propre publication (« lundi soir », « hier ») et qu'un match du joueur a commencé entre ce moment et la date de référence, l'événement porte la marque « datation à vérifier ». L'utilisateur peut lever la marque, ou avancer la date de référence à l'aide d'une source publique datée (DET-48). Tant que la marque subsiste, le document 08 décide du sort du cas : il reste en attente et n'entre dans aucun calcul (SEN-45).
- **DET-33** [Lot 2] — **Détection tardive.** Si, à la création de l'événement, le coup d'envoi de son match attendu, premier match de l'équipe du joueur postérieur à la date de référence (document 10, SUI-03), est déjà passé, l'événement porte la marque « détecté après le coup d'envoi ». Une fois le match mesuré établi (document 08), la marque est confirmée ou levée selon que le coup d'envoi de ce match précède ou non l'instant de création de l'événement ; elle coïncide alors avec la qualification « enregistré après le coup d'envoi » du cas suivi (document 10, SUI-06). Le cas reste valable, puisque la date de référence précède le match ; les documents 09 et 10 tiennent compte de la marque.
- **DET-58** [Lot 2] — **Fait déjà rapporté par un backtest.** Avant de créer un événement, l'application recherche parmi les événements historiques du joueur ceux qui correspondent au fait selon la règle de correspondance du document 06 (IMP-25) ; le modèle peut aussi désigner l'un d'eux parmi les événements récents qui lui sont fournis (DET-14). Si une correspondance existe, aucun événement détecté n'est créé, et donc ni cas suivi, ni besoin de backtest, ni fiche d'alerte : un même fait n'a qu'un cas, dont le premier enregistrement fixe l'origine (document 10, SUI-07). L'article devient « non pertinent » avec le motif « déjà rapporté par un backtest » et garde le lien vers l'événement historique ; l'utilisateur peut l'ajouter comme source de cet événement (document 06, IMP-32) ou, s'il juge le fait distinct, le repêcher (DET-49). Quand l'événement naît d'un classement ou d'un repêchage par l'utilisateur (DET-13, DET-49), la correspondance lui est signalée, et il confirme qu'il s'agit d'un fait distinct ou y renonce. Un fait d'un autre type dont la date est aussi proche de celle d'un événement historique du joueur donne un événement détecté marqué « doublon possible d'un événement historique » ; si l'utilisateur constate qu'il s'agit du même fait, il l'écarte avec le motif « doublon d'un événement historique » (DET-43, H-DET-11).

### Propositions de type

- **DET-34** [Lot 2] — Un fait qui touche l'égo sans relever d'aucun type validé ne crée pas d'événement. S'il correspond à une entrée de la liste « à ne pas reproposer » (DET-14), l'application l'ajoute à cette entrée comme nouvelle occurrence (document 02, TAX-18) : l'article passe « lié à une proposition » si l'entrée est une proposition en attente, et devient « non pertinent » avec le motif « type rejeté ou retiré » sinon. Dans le cas contraire, elle transmet au document 02 une nouvelle proposition comprenant le joueur suivi, le nom et la définition suggérés, la raison pour laquelle aucun type validé ne convient et les références de l'article (lien, média, titre, date de publication) ; l'article passe « lié à une proposition ». Le regroupement des propositions semblables, leur présentation et leur décision relèvent du document 02 ; seule une nouvelle proposition est notifiée (document 11, TEL-14).
- **DET-35** [Lot 2] — La détection ne crée, ne modifie ni ne valide jamais un type (D-12).
- **DET-36** [Lot 2] — Quand un type issu d'une proposition est validé, les articles liés sont reclassés en priorité avec la liste à jour des types validés ; les événements ainsi créés prennent la date de référence tirée de ces articles (H-DET-08). Quand la proposition est rejetée, les articles liés deviennent « non pertinents » avec le motif « proposition rejetée », et leur durée de conservation commence.

### Aiguillage

- **DET-37** [Lot 2] — Tout événement détecté est confié au suivi automatique (document 10), quelle que soit la situation du joueur (H-07) : son cas naît à l'état « en attente du match ».
- **DET-38** [Lot 2] — Si le joueur n'est pas profilé, c'est-à-dire si aucun résultat de recherche n'a été importé pour lui (glossaire du document 00), la détection signale un besoin de backtest au document 05 (D-24, D-36), qui décide de créer ou non une demande, par exemple s'il en existe déjà une à faire ; aucune fiche d'alerte n'est demandée.
- **DET-39** [Lot 2] — Si le joueur est profilé et que la couverture de son backtest inclut le type de l'événement (document 05, BKT-10), la détection demande une fiche d'alerte au document 09 (D-29).
- **DET-40** [Lot 2] — Si le joueur est profilé mais que la couverture de son backtest n'inclut pas ce type, par exemple parce que le type a été validé après la demande (H-05), la détection demande au document 09 une fiche d'alerte portant la mention « type non couvert par le backtest », dont ce document fixe le contenu, et signale au document 05 un besoin de backtest complémentaire. Dans les trois cas, l'événement est suivi (DET-37) ; le document 05 énonce le même aiguillage (BKT-30).
- **DET-41** [Lot 2] — L'aiguillage a lieu à la création de l'événement. Le rattachement d'un article supplémentaire ne le déclenche pas de nouveau. Le regroupement des messages qui en résultent relève du document 11.
- **DET-42** [Lot 2] — Après une correction du joueur ou du type, l'aiguillage est réévalué pour le nouveau joueur ou le nouveau type. Une fiche d'alerte déjà émise n'est pas supprimée : la correction est transmise au document 09, qui décide du sort de la fiche et l'inscrit dans l'historique des alertes.

### Écartement et corrections

- **DET-43** [Lot 2] — L'utilisateur peut écarter un événement détecté à tout moment, sans avoir eu à le valider auparavant (H-08). Il choisit un motif : « pas un événement », « ne relève d'aucun type validé », « fait ancien », « information non publique ou invérifiable », « doublon d'un événement historique » (DET-58), ou « autre », avec un commentaire (H-DET-06). Un mauvais joueur, un mauvais type ou le doublon d'un autre événement détecté se corrigent (DET-47) au lieu de s'écarter ; un événement à effacer pour une raison de sensibilité se retire (DET-51).
- **DET-44** [Lot 2] — Un événement écarté et son cas sortent de tous les calculs : profils, tendances générales et tableau de validation (documents 08 et 10) ; le document 10 cesse de suivre son match. L'événement reste dans l'historique avec ses articles et son motif. Un article ultérieur qui rapporte le même fait lui est rattaché et ne fait pas renaître d'événement.
- **DET-45** [Lot 2] — L'écartement est réversible : l'utilisateur peut réintégrer l'événement, qui redevient « détecté », rentre dans les calculs et reprend son suivi (H-DET-06). Écarter un événement n'annule pas la demande de backtest qu'il a suscitée ; l'utilisateur peut l'annuler lui-même (document 05, H-DET-07).
- **DET-46** [Lot 2] — L'application enregistre l'instant de chaque écartement et indique s'il est intervenu avant ou après le coup d'envoi du match mesuré ; le document 10 dispose de cette information pour le tableau de validation. Au moment d'écarter, l'interface rappelle qu'un écartement corrige une erreur de détection et ne doit jamais dépendre du résultat du match (H-01).
- **DET-47** [Lot 2] — L'utilisateur peut corriger un événement : changer son type, parmi les types validés, ou son joueur, parmi les joueurs suivis ; ajouter un second joueur touché par le même fait ; fusionner deux événements du même joueur ; détacher un article, qui forme alors son propre événement ou devient non pertinent ; corriger la description et les indications de contexte (H-09).
- **DET-48** [Lot 2] — L'utilisateur peut avancer la date de référence en fournissant une source publique datée (lien, média, instant de publication) ; cette source est conservée avec l'événement comme les autres. Il ne peut pas fixer une date postérieure à celle de l'article de référence : pour la retarder, il doit détacher cet article.
- **DET-49** [Lot 2] — L'utilisateur peut repêcher un article « non pertinent » encore conservé, quel que soit son motif : il choisit le joueur suivi et le type validé, et l'événement est créé ou complété avec l'origine « utilisateur » ; l'aiguillage s'applique normalement. Repêcher un article au motif « déjà rapporté par un backtest » revient à affirmer que le fait est distinct de l'événement historique désigné (DET-58). Le repêchage ne porte que sur des articles collectés (Q-DET-01).
- **DET-50** [Lot 2] — L'utilisateur peut demander une nouvelle classification d'un article ; elle consomme du quota et passe en tête de la file.
- **DET-51** [Lot 2] — Écarter n'est pas retirer : le retrait d'un événement pour protéger la vie privée efface ses données selon le document 13 (DSN-26 à DSN-29), alors que l'écartement les conserve. Le retrait efface aussi les articles rattachés à ce seul événement (document 03, COL-37), leurs résultats de classification et l'historique de ses corrections ; la demande de backtest qu'il a suscitée demeure (document 05, BKT-14).
- **DET-52** [Lot 2] — Tout écartement, toute réintégration, toute correction et tout repêchage sont tracés (instant, valeur avant, valeur après, motif) et déclenchent le recalcul des profils concernés (document 08). Pour une correction de la description, seule la modification est notée, sans l'ancien texte, qui pouvait contenir ce que la correction voulait ôter (D-20, document 13).

### Traçabilité et journal de détection

- **DET-53** [Lot 2] — Pour chaque événement, l'application conserve : la version de la fiche de son type sous laquelle il a été qualifié, celle en vigueur à sa création ou à sa dernière correction de type (document 02, TAX-23) ; les articles qui l'ont fait naître ou l'ont complété ; l'article de référence ; pour chaque article, le résultat de classification qui l'a rattaché (type, confiance de détection, justification, instant, origine « modèle » ou « utilisateur », version des instructions, types validés à cet instant) ; l'historique de ses corrections.
- **DET-54** [Lot 2] — Pour chaque article, l'application indique son sort : joueurs reconnus au préfiltrage, résultats de classification successifs, événement de rattachement ou motif de non-pertinence. Les résultats de classification d'un article supprimé sont supprimés avec lui (document 03).
- **DET-55** [Lot 2] — Chaque exécution produit une entrée du journal de détection : articles reçus, non retenus par le préfiltrage, classés, classés sans fait, rattachés à un événement existant, sous le seuil, faits anciens, faits déjà rapportés par un backtest, propositions transmises, occurrences ajoutées à la liste « à ne pas reproposer », descriptions remplacées, classifications en échec, événements créés, articles restant en file, quota consommé et restant.
- **DET-56** [Lot 2] — Sur une période choisie par l'utilisateur, l'application présente des indicateurs de qualité : événements détectés, écartés (par motif, avant ou après le match), corrigés et repêchés, et propositions de type transmises. Ils permettent de juger honnêtement la justesse de la détection.

## Données manipulées

- **Événement détecté** (définition générale dans le document 00) : joueur suivi ; type validé et version de sa fiche ; date de référence et sa précision ; article de référence ; articles rattachés ; description factuelle ; confiance de détection, égale à la plus élevée des confiances de détection des articles rattachés ; indications de contexte (retour de blessure, enjeu du match), sous la forme fermée du document 05 ; marques « datation à vérifier », « détecté après le coup d'envoi » et « doublon possible d'un événement historique » ; mention « description à revoir » ; origine (modèle ou utilisateur) ; instant de création ; état (détecté ou écarté) ; pour un écartement, motif, commentaire, instant et position par rapport au coup d'envoi du match mesuré ; historique des corrections ; liens vers le besoin de backtest transmis, la fiche d'alerte demandée et le cas suivi.
- **Résultat de classification**, par article et par joueur reconnu : faits rapportés avec, pour chacun, le type, ou l'entrée de la liste « à ne pas reproposer », ou le nom et la définition de type suggérés, la confiance de détection, la description, la justification, la mention « fait nouveau » ou l'événement existant désigné, détecté ou historique, l'indication d'antériorité et les indications de contexte ; instant ; origine ; version des instructions ; numéro de tentative.
- **Proposition transmise** : joueur suivi, nom et définition suggérés, raison pour laquelle aucun type validé ne convient, références des articles liés (lien, média, titre, date de publication), instant de transmission ; pour une occurrence, l'entrée de la liste « à ne pas reproposer » concernée.
- **Décompte d'exposition** : joueur suivi, jour, nombre d'articles qui l'ont cité (DET-57).
- **Élément de la file d'attente** : article, joueurs reconnus, priorité, instant d'entrée, tentatives, marque « classification en échec ».
- **Entrée du journal de détection** : contenu de la règle DET-55.
- **Données lues** : articles et leurs instants retenus (document 03) ; noms, variantes et états des joueurs (document 01) ; fiches des types validés et liste « à ne pas reproposer » (document 02) ; prochain match et coups d'envoi (document 07) ; joueur profilé ou non (document 00) et couverture de son backtest (document 05) ; événements historiques du joueur (document 06) ; limites de quota (document 14).
- **Paramètres** : seuil de détection, nombre de tentatives, fenêtre de regroupement, horizon de priorité, intervalle de reprise. Ils figurent dans les réglages centralisés (document 14). La longueur maximale de la description est celle du document 13 (DSN-20) ; la marge de vigilance sur la confiance de détection est celle du document 09 (H-ALE-06).

## Cas limites et erreurs

- **Liste de résultats.** Un article cite le joueur A parmi les scores de la nuit : il passe le préfiltrage, puis le modèle ne trouve aucun fait, et l'article devient « non pertinent » avec le motif « aucun fait ».
- **Homonyme.** Un article parle d'une autre personne portant le nom du joueur A : le modèle répond qu'aucun fait ne touche le joueur suivi. Si cela se répète, l'utilisateur peut signaler la variante comme ambiguë dans la fiche du joueur (document 01).
- **Même fait, deux langues.** Un média national en français et un média américain en anglais rapportent le même fait : le second article est rattaché à l'événement créé par le premier, car le modèle reçoit les événements récents du joueur.
- **Deux faits dans un article.** Un article rapporte à la fois une humiliation publique et l'anniversaire du joueur A : si les deux types sont validés, deux événements distincts sont créés, chacun avec son type.
- **Conflit entre deux joueurs suivis.** Le joueur A et le joueur B s'opposent publiquement : un événement est créé pour chacun, avec chacun son cas.
- **Article postérieur à un match qui évoque un fait antérieur.** La date de référence reste celle de la première publication connue ; si l'article situe le fait avant le match, la marque « datation à vérifier » s'applique.
- **Information démentie.** Un fait rapporté puis démenti : l'utilisateur écarte l'événement avec le motif « information non publique ou invérifiable », ou le maintient si le fait public lui-même relève d'un type validé.
- **Modèle indisponible pendant plusieurs jours.** La file grossit sans perte et l'incident reste ouvert ; l'utilisateur peut classer lui-même les articles les plus urgents ; à la reprise, des événements peuvent porter la marque « détecté après le coup d'envoi ».
- **Conditions du palier gratuit modifiées.** Le service refuse avant la limite déclarée : l'application le traite comme un quota atteint et invite l'utilisateur à vérifier les conditions (document 14).
- **Type retiré.** Un type passe à l'état retiré : il n'est plus fourni au modèle ; le sort des événements existants de ce type relève du document 02.
- **Joueur mis en pause.** Ses événements existants restent inchangés ; ses nouveaux articles ne sont plus rapprochés de lui (H-DET-01).
- **Événement hors saison.** Il est enregistré normalement ; le document 08 décide si un match lointain peut servir de match mesuré.
- **Prochain match inconnu.** La source de statistiques ne répond pas : la priorité suit l'instant de publication (DET-09).
- **Événement retrouvé par un backtest.** Un événement détecté figure aussi dans le résultat de recherche importé plus tard pour le même joueur : le document 06 le reconnaît (IMP-25, IMP-27). À l'inverse, un fait déjà importé qui réapparaît dans un article ne crée pas d'événement détecté (DET-58) ; il ne donne alors aucune fiche d'alerte, et son cas, historique, ne compte jamais comme test (document 10, SUI-05). Dans un sens comme dans l'autre, le même fait n'est jamais compté deux fois (SUI-07).
- **Variante partagée par deux joueurs suivis.** Un article qui ne cite qu'un prénom commun aux joueurs A et B est retenu pour les deux ; le modèle désigne celui que le fait touche, ou aucun (DET-04, DET-17).
- **Description qui cite des propos entre guillemets.** Elle n'est pas enregistrée : l'événement reçoit une description type et la mention « description à revoir » (DET-21).

## Critères d'acceptation

- **CA-DET-01** (DET-01, DET-06) — Étant donné un article qui ne cite aucun joueur suivi, quand la détection s'exécute, alors il devient « non pertinent » avec le motif « aucun joueur suivi » et aucun appel au modèle n'est compté.
- **CA-DET-02** (DET-03) — Étant donné le surnom court du joueur A et un article où ces lettres n'apparaissent qu'à l'intérieur d'un autre mot, quand le préfiltrage s'exécute, alors le joueur A n'est pas reconnu.
- **CA-DET-03** (DET-04) — Étant donné une variante signalée ambiguë pour le joueur A, quand un article la cite sans autre variante ni nom de l'équipe X du joueur, alors l'article n'est pas retenu pour le joueur A ; quand il cite aussi l'équipe X, alors il est retenu.
- **CA-DET-04** (DET-02) — Étant donné un joueur en pause, quand un article le cite, alors le préfiltrage ne le reconnaît pas.
- **CA-DET-05** (DET-07) — Étant donné un article collecté la veille qui citait un surnom du joueur A encore inconnu, quand l'utilisateur ajoute ce surnom, alors l'article repasse au préfiltrage et entre en file d'attente pour le joueur A.
- **CA-DET-06** (DET-08, DET-11) — Étant donné une limite quotidienne de 100 appels, atteinte alors que 30 articles sont encore en attente, quand la détection poursuit son traitement, alors aucun appel supplémentaire n'est fait, les 30 articles restent en attente et un incident « quota atteint » indique leur nombre.
- **CA-DET-07** (DET-09) — Étant donné un article sur le joueur A, qui joue dans 10 heures, et un article plus ancien sur le joueur B, qui joue dans 5 jours, quand le quota ne permet qu'un appel, alors l'article sur le joueur A est classé en premier.
- **CA-DET-08** (DET-10) — Étant donné une file non vide et un quota renouvelé, quand la tâche de reprise passe, alors les articles en attente sont classés dans l'ordre de priorité.
- **CA-DET-09** (DET-15, DET-22) — Étant donné une réponse du modèle qui attribue à un fait, comme type validé, un type à l'état proposé, quand la réponse est contrôlée, alors aucun événement n'est créé, l'article est soumis de nouveau, puis marqué « classification en échec » après la dernière tentative.
- **CA-DET-10** (DET-17) — Étant donné un article qui rapporte une altercation publique entre le joueur A et le joueur B, tous deux suivis, quand l'article est classé au-dessus du seuil, alors deux événements sont créés, un par joueur.
- **CA-DET-11** (DET-19) — Étant donné deux articles qui rapportent la même critique publique du joueur A, l'un ajoutant qu'il a ensuite marqué 40 points, l'autre non, quand ils sont classés, alors l'existence et le type de l'événement sont jugés de la même façon pour les deux.
- **CA-DET-12** (DET-20) — Étant donné un article qui revient sur un fait vieux de plusieurs années concernant le joueur A, sans élément nouveau, quand il est classé, alors aucun événement n'est créé et l'article devient « non pertinent » avec le motif « fait ancien ».
- **CA-DET-13** (DET-24) — Étant donné un seuil de détection de 70, quand le modèle rend une confiance de détection de 65, alors aucun événement n'est créé, l'article devient « non pertinent » avec le motif « sous le seuil » et la réponse du modèle reste consultable.
- **CA-DET-14** (DET-26) — Étant donné des événements créés avec le seuil de 70, quand l'utilisateur porte le seuil à 80, alors aucun événement existant n'est modifié.
- **CA-DET-15** (DET-28, DET-30, DET-31) — Étant donné un événement créé à partir d'un article publié à 14 h, quand un article publié à 11 h le même jour et rapportant le même fait lui est rattaché, alors la date de référence passe à 11 h et l'article de 11 h devient l'article de référence.
- **CA-DET-16** (DET-32) — Étant donné un article publié le mardi à 15 h, heure de Paris, qui situe le fait « dimanche », et un match du joueur A commencé le lundi à 19 h 30, heure de New York, quand l'événement est créé, alors il porte la marque « datation à vérifier ».
- **CA-DET-17** (DET-33) — Étant donné un article publié avant un match mais classé après le coup d'envoi à cause du quota, quand l'événement est créé, alors il porte la marque « détecté après le coup d'envoi » et sa date de référence reste celle de la publication.
- **CA-DET-18** (DET-34, DET-35) — Étant donné un article qui rapporte un fait touchant l'égo du joueur A sans correspondre à aucun type validé, quand il est classé, alors aucun événement ni aucun type n'est créé, une proposition de type est transmise au document 02 et l'article passe « lié à une proposition ».
- **CA-DET-19** (DET-36) — Étant donné une proposition issue de deux articles, quand l'utilisateur valide le type proposé, alors ces articles sont reclassés en priorité et, s'ils relèvent du nouveau type, l'événement créé prend pour date de référence la publication du plus ancien.
- **CA-DET-20** (DET-37, DET-38) — Étant donné le joueur A, non profilé, quand un événement est détecté pour lui, alors son cas est créé « en attente du match », un besoin de backtest est transmis au document 05 et aucune fiche d'alerte n'est demandée.
- **CA-DET-21** (DET-37, DET-39) — Étant donné le joueur B, profilé, dont la couverture inclut le type de l'événement, quand un événement est détecté pour lui, alors son cas est créé et une fiche d'alerte est demandée au document 09.
- **CA-DET-22** (DET-40) — Étant donné le joueur B, profilé, dont le backtest est antérieur à la validation du type de l'événement, quand l'événement est détecté, alors son cas est créé, une fiche d'alerte portant la mention « type non couvert par le backtest » est demandée au document 09 et un besoin de backtest complémentaire est transmis au document 05.
- **CA-DET-23** (DET-41) — Étant donné un événement déjà aiguillé, quand un troisième article lui est rattaché, alors aucune nouvelle demande de fiche d'alerte ni aucun nouveau besoin de backtest n'est émis.
- **CA-DET-24** (DET-43, DET-44, DET-46) — Étant donné un événement détecté dont le match mesuré a été joué, quand l'utilisateur l'écarte avec le motif « pas un événement », alors son cas sort des profils, des tendances et du tableau de validation, l'écartement est enregistré comme postérieur au coup d'envoi et l'événement reste consultable avec son motif.
- **CA-DET-25** (DET-44) — Étant donné un événement écarté, quand un nouvel article rapporte le même fait, alors cet article est rattaché à l'événement écarté et aucun nouvel événement n'est créé.
- **CA-DET-26** (DET-45) — Étant donné un événement écarté, quand l'utilisateur le réintègre, alors il redevient « détecté » et son cas rentre dans les calculs.
- **CA-DET-27** (DET-42, DET-47, DET-52) — Étant donné un événement rattaché par erreur au joueur A, quand l'utilisateur le rattache au joueur B, alors la correction est tracée avec la valeur avant et après, les profils des deux joueurs sont recalculés et l'aiguillage est réévalué pour le joueur B.
- **CA-DET-28** (DET-48) — Étant donné un événement dont l'article de référence a été publié un jeudi, quand l'utilisateur fournit le lien d'un article public d'un média national publié la veille, alors la date de référence passe au mercredi et la source est conservée avec l'événement ; quand il tente de fixer la date au vendredi, alors la modification est refusée.
- **CA-DET-29** (DET-49) — Étant donné un article « non pertinent » avec le motif « sous le seuil », quand l'utilisateur le repêche en choisissant le joueur A et un type validé, alors un événement d'origine « utilisateur » est créé et aiguillé.
- **CA-DET-30** (DET-13) — Étant donné un modèle indisponible depuis deux jours, quand l'utilisateur classe lui-même un article en attente, alors l'article quitte la file et le résultat porte l'origine « utilisateur ».
- **CA-DET-31** (DET-53, DET-54) — Étant donné un événement issu de trois articles, quand l'utilisateur ouvre l'événement, alors il voit les trois articles, l'article de référence et, pour chacun, le résultat de classification qui l'a rattaché ; depuis chaque article, il retrouve l'événement.
- **CA-DET-32** (DET-50) — Étant donné un article classé « sous le seuil » et une file qui contient vingt articles, quand l'utilisateur demande une nouvelle classification de cet article, alors celui-ci passe en tête de la file et l'appel est décompté du quota.
- **CA-DET-33** (DET-55, DET-56) — Étant donné une exécution de la détection, quand l'utilisateur ouvre le journal de détection, alors il voit les compteurs de la règle DET-55 ; quand il choisit une période, alors il voit le nombre d'événements détectés, écartés (par motif, avant ou après le match), corrigés et repêchés.
- **CA-DET-34** (DET-58) — Étant donné un événement historique de type « humiliation-publique » importé pour le joueur A et daté de la veille, quand un article rapporte le même fait et que le modèle le classe dans ce type au-dessus du seuil, alors aucun événement détecté n'est créé, aucun cas suivi, aucune demande ni aucune fiche d'alerte, et l'article devient « non pertinent » avec le motif « déjà rapporté par un backtest », en désignant l'événement historique.
- **CA-DET-35** (DET-58, DET-43) — Étant donné le même événement historique, quand un article rapportant le même fait est classé dans un autre type validé, alors un événement détecté est créé avec la marque « doublon possible d'un événement historique » ; quand l'utilisateur l'écarte avec le motif « doublon d'un événement historique », alors son cas sort de tous les calculs.
- **CA-DET-36** (DET-57) — Étant donné une conservation des articles non pertinents réglée à 7 jours et 12 articles citant le joueur A collectés il y a 20 jours, puis purgés, quand l'utilisateur ouvre la fiche du joueur A, alors l'indicateur d'exposition sur 30 jours les compte toujours.
- **CA-DET-37** (DET-21) — Étant donné une réponse du modèle dont la description reproduit des propos entre guillemets, quand l'événement est créé, alors cette description n'est pas enregistrée, l'événement reçoit une description type et la mention « description à revoir », et l'article n'est pas soumis de nouveau.
- **CA-DET-38** (DET-34) — Étant donné un type rejeté, quand un article rapporte un fait qui lui correspond, alors aucune proposition n'est créée, une occurrence est ajoutée au type rejeté et l'article devient « non pertinent » avec le motif « type rejeté ou retiré ».
- **CA-DET-39** (DET-04) — Étant donné une variante partagée par les joueurs A et B, quand un article la cite avec le nom de l'équipe de A seulement, alors seul le joueur A est reconnu ; quand il la cite seule, alors les deux joueurs sont reconnus.

## Dépendances

- [00 — Vue d'ensemble](00-vue-d-ensemble.md) : glossaire et définition générale de l'événement.
- [01 — Joueurs suivis](01-joueurs-suivis.md) : noms, variantes, surnoms, variantes partagées, éventuelle marque de variante ambiguë, équipe, état actif, en pause ou retiré (JOU-09, JOU-18) ; indicateur d'exposition (JOU-03).
- [02 — Taxonomie des événements](02-taxonomie-des-evenements.md) : fiches des types validés, transmises en entier (TAX-33), et leur version (TAX-23) ; liste « à ne pas reproposer », réception, regroupement et décision des propositions (TAX-18) ; sort des événements d'un type retiré.
- [03 — Collecte des actualités](03-collecte-des-actualites.md) : articles, instants retenus et leur précision, états de traitement et conservation ; effacement des articles d'un événement retiré (COL-37).
- [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) : couverture des backtests (BKT-10) et même aiguillage (BKT-30) ; reçoit les besoins de backtest, y compris complémentaires, et évite les demandes en double ; valeurs fermées du contexte.
- [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) : événements historiques du joueur et règle de correspondance (IMP-25) ; reconnaît, à l'import, un événement historique qui double un événement détecté (IMP-27).
- [07 — Statistiques de match](07-statistiques-de-match.md) : prochain match et coups d'envoi, pour la priorité de la file et les marques de datation.
- [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) : rattache l'événement à son match mesuré, traite les marques de datation, définit le retour de blessure et l'enjeu du match (SEN-13, SEN-14) et recalcule après chaque écartement ou correction.
- [09 — Fiche d'alerte](09-fiche-d-alerte.md) : produit la fiche demandée, y compris avec la mention « type non couvert par le backtest », signale une confiance de détection proche du seuil (ALE-16, H-ALE-06) et tient l'historique des alertes, y compris les corrections ; produit la fiche lorsque le backtest d'un joueur est importé avant le coup d'envoi du match d'un de ses événements détectés (ALE-05).
- [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) : suit le match de chaque événement détecté (SUI-01, SUI-03), qualifie le cas enregistré après le coup d'envoi (SUI-06), fixe l'origine unique d'un cas (SUI-07), cesse ou reprend le suivi selon l'écartement, exploite la position des écartements par rapport au coup d'envoi ; Q-SUI-02.
- [11 — Notifications Telegram](11-notifications-telegram.md) : messages « quota atteint », proposition de nouveau type, demande de backtest, alerte.
- [12 — Interface et accès](12-interface-et-acces.md) : écrans des événements détectés et de la fiche d'un événement (IHM-32, IHM-67), des articles non pertinents, de la file d'attente et du journal de détection (IHM-71), du retrait d'un événement (IHM-68).
- [13 — Données sensibles](13-donnees-sensibles.md) : contenu admis dans la description et la justification, longueur maximale et contrôles (DSN-19 à DSN-25) ; données publiques seules transmises au modèle (DSN-05) ; retrait d'un événement (DSN-26 à DSN-29).
- [14 — Exigences transverses](14-exigences-transverses.md) : limites de quota, tâche de reprise, réglages, journalisation, instants absolus.

## Hypothèses et questions ouvertes

Renvois au journal : Q-02 (aucun modèle n'est choisi ; les critères figurent dans le document 14), Q-06 (événements d'équipe hors périmètre, d'où DET-18), H-07, H-08 et H-09 (hypothèses de rédaction appliquées ici).

Renvoi à un autre document : Q-SUI-02 du document 10. La détection s'enchaîne à la collecte, dont l'heure (document 03, H-COL-01) fixe la part des cas suivis enregistrés avant le coup d'envoi ; la meilleure heure reste ouverte.

Hypothèses locales, toutes à confirmer :

- **H-DET-01 — Joueurs préfiltrés.** Seuls les joueurs actifs sont recherchés ; un joueur en pause ou retiré ne l'est pas, comme le prévoit le document 01 (JOU-18, JOU-19).
- **H-DET-02 — Variantes ambiguës et partagées.** La fiche du joueur permet de marquer une variante comme ambiguë ; une telle variante exige un indice complémentaire (autre variante ou nom de l'équipe). Une variante partagée par plusieurs joueurs suivis les fait tous reconnaître, sauf indice propre à l'un d'eux. Le document 01 prévoit cette marque et ce signalement (JOU-09).
- **H-DET-03 — Réglages de la classification.** Confiance de détection exprimée de 0 à 100 ; seuil de détection à 70 ; 2 tentatives pour une réponse inexploitable ; description type à la place d'une description non conforme, sans nouvelle soumission au modèle ; changement de seuil sans effet rétroactif ; instructions du modèle consultables mais non modifiables depuis l'application. La longueur maximale de la description est celle du document 13 (DSN-20).
- **H-DET-04 — Fenêtre de regroupement.** 72 heures avant l'instant retenu de l'article.
- **H-DET-05 — File d'attente.** Horizon de priorité de 48 heures avant le coup d'envoi ; reprise toutes les 6 heures tant que la file n'est pas vide.
- **H-DET-06 — Écartement.** Liste fermée de motifs, dont « doublon d'un événement historique », complétée par « autre » avec commentaire ; écartement réversible.
- **H-DET-07 — Demande de backtest maintenue.** Écarter l'événement qui a suscité une demande de backtest n'annule pas cette demande, puisque le backtest reste utile au profil du joueur.
- **H-DET-08 — Reclassement après validation d'un type.** Les articles à l'origine d'une proposition validée sont reclassés et peuvent créer des événements avec leur date de publication d'origine, ce qui préserve l'exhaustivité (H-01).
- **H-DET-09 — Nouveau préfiltrage.** À l'ajout ou à la réactivation d'un joueur, ou à l'ajout d'une variante, seuls les articles qui ne dépassent pas l'ancienneté maximale de la collecte sont repris, afin de ne pas créer d'événements anciens.
- **H-DET-10 — Fait ancien.** Le rappel, sans élément nouveau, d'un fait rendu public avant la fenêtre de regroupement ne crée pas d'événement.
- **H-DET-11 — Fait déjà rapporté par un backtest.** Un fait qui correspond, selon la règle du document 06, à un événement historique du joueur ne crée pas d'événement détecté ; un fait d'un autre type à une date proche est créé mais signalé comme doublon possible, que l'utilisateur tranche. Cette règle applique au moment de la détection le principe d'une seule origine par cas (document 10, SUI-07).

Question ouverte locale :

- **Q-DET-01 — Déclaration manuelle d'un événement.** L'utilisateur peut apprendre un fait par une autre voie que les sources collectées. Faut-il lui permettre de déclarer un événement à partir d'un lien qui n'a pas été collecté ? Risque : il choisirait les faits qu'il croit porteurs, ce qui biaiserait le tableau de validation. Par défaut, ce n'est pas prévu ; si c'est retenu, ces événements doivent porter une origine distincte et être isolés dans le tableau de validation (document 10).
