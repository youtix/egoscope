# 05 — Demande de backtest et prompt

## Objet

Une demande de backtest est la tâche que l'application confie à l'utilisateur : faire reconstituer, par une IA de recherche approfondie qu'il utilise lui-même, tous les événements passés d'un joueur suivi. Ce document fixe quand une demande naît, ce qu'elle contient et comment elle évolue, le texte du prompt de recherche que l'application produit, et le format JSON que l'IA doit renvoyer, illustré par un exemple complet. Le collage et le contrôle de ce JSON relèvent de [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md).

## Décisions d'origine

- **D-01** — L'hypothèse se vérifie en confrontant des événements passés aux statistiques réelles : c'est le backtest.
- **D-02** — Un seul utilisateur.
- **D-07 bis** — Gratuité totale, services compris.
- **D-09** — L'application fournit un prompt qui impose un format de retour ; l'utilisateur l'exécute lui-même en recherche approfondie et rapporte le résultat.
- **D-10** — Sources de presse datées et vérifiables, qui garantissent que l'événement était connu avant le match.
- **D-12** — Seuls les types validés, définis par leur fiche, sont recherchés.
- **D-14** — Le résultat revient en JSON strict.
- **D-17** — 20 à 30 joueurs suivis, ce qui borne le nombre de demandes.
- **D-19** — Des champs de contexte (retour de blessure, enjeu du match) permettent d'exclure les cas douteux.
- **D-20** — Presse publique uniquement, stockage minimal, aucun détail intime.
- **D-24** — Un événement détecté pour un joueur sans backtest déclenche une demande de recherche approfondie.
- **D-25** — Application installable sur téléphone : le prompt se copie depuis le téléphone.
- **D-27** — La recherche ne fournit que les événements, aucune statistique.
- **D-32** — Les convictions de l'utilisateur reposent sur des exemples marquants : un historique trié les confirmerait à tort.
- **D-36** — Pas de lot initial : les backtests sont demandés au fil des détections, et le match peut être joué avant que le backtest soit prêt.
- **H-01** — Tous les événements comptent, y compris ceux suivis d'une contre-performance.
- **H-02** — Le match mesuré est le premier match joué après que l'événement est devenu public.
- **H-05** — Un backtest couvre tous les types validés à la date de la demande ; un type validé plus tard peut donner lieu à une demande complémentaire.
- **H-06** — Le backtest porte sur toute la carrière NBA du joueur.
- **H-07** — La demande affiche l'échéance du prochain match ; l'événement détecté est suivi même sans backtest.
- **H-08** — L'utilisateur peut écarter un événement détecté à tort.
- **H-09** — Le retour de blessure et l'enjeu du match peuvent être signalés par la recherche, puis corrigés par l'utilisateur.
- **H-11** — Interface en français ; presse surtout anglophone.
- **H-12** — Au lot 1, la demande se déclenche à la main ; la détection quotidienne arrive au lot 2. Ce déclenchement manuel vient de cette hypothèse, pas d'une décision : D-36 prévoit des backtests demandés au fil des détections, et l'application ne crée jamais d'office de demande pour toute la liste (document 00).

## Périmètre

Ce document couvre :

- la naissance des demandes (à la main, à la détection, en complément) et la règle d'une seule demande ouverte par joueur ;
- l'étendue d'un backtest et la couverture qui en résulte pour chaque joueur ;
- le contenu d'une demande, ses états, son échéance et son rang dans la liste « à faire » ;
- le texte du prompt de recherche et ses parties variables ;
- le format du résultat de recherche (version 1.0), un exemple complet et le résultat vide ;
- les limites connues des IA de recherche et les parades prévues.

Il ne couvre pas :

- le collage, les contrôles, l'aperçu, l'enregistrement et la correction du résultat : [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) ;
- la détection qui déclenche les demandes automatiques : [04 — Détection des événements](04-detection-des-evenements.md) ;
- les fiches de type, leur cycle de vie et le prompt d'exploration de nouveaux types : [02 — Taxonomie des événements](02-taxonomie-des-evenements.md) ;
- la fiche et les états d'un joueur : [01 — Joueurs suivis](01-joueurs-suivis.md) ;
- le calendrier, le prochain match et la date du premier match NBA : [07 — Statistiques de match](07-statistiques-de-match.md) ;
- le rattachement au match mesuré, les cas et leurs exclusions : [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) ;
- le suivi des événements détectés : [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) ;
- le texte et l'envoi de la notification « demande de backtest à faire » : [11 — Notifications Telegram](11-notifications-telegram.md) ;
- la présentation de la liste « à faire » et des écrans : [12 — Interface et accès](12-interface-et-acces.md) ;
- les règles générales sur les données sensibles : [13 — Données sensibles](13-donnees-sensibles.md).

## Acteurs et déclencheurs

- **L'utilisateur**, seul utilisateur (D-02) : demande un backtest, copie le prompt, lance la recherche, rapporte le résultat, met à jour, réduit ou annule une demande.
- **L'application** : crée les demandes, produit le prompt, calcule l'échéance et le rang de chaque demande, tient la couverture de chaque joueur.
- **L'IA de recherche approfondie** : outil extérieur choisi par l'utilisateur, qu'aucune exigence ne nomme (Q-02). L'application ne l'appelle jamais : l'utilisateur fait le lien (D-09).
- **Déclencheurs au lot 1** : l'action « Demander un backtest » sur la fiche d'un joueur ; la validation, la réactivation ou l'élargissement d'un type ; un import qui laisse la couverture incomplète.
- **Déclencheurs au lot 2** : un événement détecté pour un joueur non profilé, ou pour un joueur profilé dont la couverture n'inclut pas le type de l'événement (BKT-30).

## Parcours

### Scénario nominal (lot 1, demande à la main)

1. Sur la fiche du joueur A, actif et sans backtest, l'utilisateur touche « Demander un backtest ».
2. L'application vérifie qu'aucune demande n'est à faire pour ce joueur et qu'au moins un type est validé.
3. Elle crée la demande à l'état « à faire », avec tous les types validés, chacun sur toute la carrière NBA du joueur jusqu'à la date du jour.
4. Elle produit le prompt et affiche la demande : joueur, types, période, prochain match, prompt avec les actions « Copier » et « Partager ».
5. L'utilisateur copie le prompt, le colle dans son IA de recherche approfondie et lance la recherche.
6. Quand l'IA a répondu, il copie toute la réponse et l'importe (document 06).
7. À la confirmation de l'import, la demande passe à « importée » et la couverture du joueur est mise à jour.

### Variantes

- **Détection (lot 2)** : la demande naît sans intervention, rattachée à l'événement détecté ; la notification « demande de backtest à faire » part ; la demande est urgente tant que le match mesuré de l'événement n'est pas joué.
- **Demande déjà ouverte** : l'action manuelle ouvre la demande existante ; une nouvelle détection s'y rattache.
- **Nouveau type validé, réactivé ou élargi** : l'application propose, pour chaque joueur déjà traité, une demande complémentaire limitée à ce type.
- **Joueur déjà traité** : l'action manuelle propose « compléter » (ce qui manque à la couverture, jusqu'à la date du jour) ou « refaire » (tous les types validés sur toute la carrière).
- **Réponse trop longue** : l'IA s'arrête à la fin d'une saison et déclare la période réellement couverte ; après l'import, l'application propose un complément pour la suite. Si la réponse est coupée et inutilisable, l'utilisateur réduit la demande avant de relancer la recherche.
- **Mise à jour** : avant de lancer la recherche, l'utilisateur intègre à la demande les types validés depuis sa création.
- **Annulation** : par l'utilisateur, ou automatiquement quand le joueur est retiré de la liste.
- **Aucun événement trouvé** : le résultat vide est importé comme un backtest à part entière.

## Règles de gestion

### Naissance d'une demande

- **BKT-01 [Lot 1] — Demande à la main.** Sur la fiche d'un joueur suivi actif ou en pause (document 01), l'action « Demander un backtest » crée une demande déclenchée à la main. Pour un joueur sans backtest, c'est une demande initiale (BKT-08) ; pour un joueur déjà traité, l'application propose de « compléter », choix par défaut, ce qui crée un complément, ou de « refaire », ce qui crée une reprise complète (BKT-09). Aucune demande ne peut être créée pour un joueur retiré.
- **BKT-02 [Lot 1] — Aucun type validé.** Tant qu'aucun type n'est validé (document 02), aucune demande ne peut être créée ; l'action l'explique et mène à la taxonomie.
- **BKT-03 [Lot 2] — Demande à la détection.** Quand la détection (document 04) enregistre un événement à l'état « détecté » pour un joueur actif sans backtest, c'est-à-dire non profilé (BKT-10), et sans demande à faire, l'application crée une demande initiale, née de la détection et rattachée à cet événement, et demande l'envoi de la notification « demande de backtest à faire » (document 11). L'événement détecté est enregistré et suivi, qu'un backtest existe ou non (H-07, document 10).
- **BKT-04 [Lot 2] — Complément à la détection.** Quand la détection enregistre, pour un joueur actif déjà traité et sans demande à faire, un événement d'un type que sa couverture ne comprend pas, l'application crée un complément, né de la détection et rattaché à l'événement, qui porte sur tous les types validés non couverts (H-BKT-03). Aucune notification séparée n'est demandée : le message d'alerte du document 11 annonce ce complément (TEL-11).
- **BKT-05 [Lot 1] — Complément à la validation, à la réactivation ou à l'élargissement d'un type.** Quand un type est validé ou réactivé (document 02, TAX-20, TAX-32), ou élargi par une modification de fond (TAX-24), l'application liste les joueurs déjà traités dont la couverture ne comprend pas ce type, ou ne le comprend que sous une version de fiche antérieure à l'élargissement, et propose de créer pour eux un complément limité à ce type, joueur par joueur ou pour tous en une fois. Elle ne crée rien sans accord, H-05 prévoyant qu'une telle demande « peut » être émise. Pour un joueur qui a déjà une demande à faire, elle propose plutôt la mise à jour de celle-ci (BKT-15).
- **BKT-06 [Lot 1] — Complément après un import incomplet.** Quand un import laisse sans couverture une partie de ce que la demande prévoyait (type non traité, réponse arrêtée en cours de carrière, partie retirée par réduction), le bilan d'import (document 06) et la fiche du joueur proposent le complément qui couvre ce manque ; il n'est créé que sur accord.
- **BKT-07 [Lot 1] — Une seule demande ouverte par joueur.** Un joueur a au plus une demande « à faire ». Un déclencheur qui survient pendant ce temps n'en crée pas d'autre : l'action manuelle ouvre la demande existante ; au lot 2, un nouvel événement détecté est rattaché à la demande existante, dont l'échéance et le rang sont recalculés, et, si son type n'y figure pas, l'application signale que la mise à jour de la demande permettrait de l'inclure (BKT-15).
- **BKT-30 [Lot 2] — Aiguillage après détection.** La couverture que tient ce document (BKT-10) décide de la suite donnée à chaque événement détecté, dans les mêmes termes que le document 04 (DET-38 à DET-40) et le document 09 :
  - joueur non profilé, c'est-à-dire sans aucun résultat de recherche importé (document 00) : demande de backtest (BKT-03), pas de fiche d'alerte ;
  - joueur profilé dont la couverture inclut le type de l'événement : fiche d'alerte (document 09) ;
  - joueur profilé dont la couverture n'inclut pas ce type : fiche d'alerte portant la mention « type non couvert par le backtest » (document 09) et demande complémentaire (BKT-04).

  Dans les trois cas, l'événement est suivi (document 10).

### Étendue d'un backtest et couverture

- **BKT-08 [Lot 1] — Étendue initiale.** Une demande initiale porte sur tous les types validés à la date de sa création (H-05), chacun sur toute la carrière NBA du joueur (H-06) : du jour de son premier match NBA, fourni par le document 07 (STA-47), à la date de création de la demande (H-BKT-01). Si la date du premier match est inconnue, le prompt demande à l'IA de partir du premier match NBA du joueur.
- **BKT-09 [Lot 1] — Étendue d'un complément et d'une reprise.** Un complément fixe une période par type : un type jamais couvert est demandé sur toute la carrière ; un type déjà couvert l'est du premier jour non couvert jusqu'à la date de création ; un type élargi depuis sa dernière recherche l'est de nouveau sur toute la carrière, sous sa version en vigueur, les faits déjà enregistrés étant reconnus comme doublons à l'import (document 06). Selon son déclencheur, il porte sur le type nouvellement validé, réactivé ou élargi (BKT-05), sur les types non couverts (BKT-04), sur les manques laissés par un import (BKT-06), ou, pour « compléter », sur tous les types validés. Une reprise complète porte sur tous les types validés, sur toute la carrière ; à l'import, l'utilisateur peut choisir de remplacer l'existant (document 06).
- **BKT-10 [Lot 1] — Couverture.** La couverture d'un joueur indique, pour chaque type, les périodes déjà couvertes par un résultat importé, chacune avec la version de la fiche sous laquelle elle a été recherchée (document 02, TAX-23). Chaque import l'enrichit avec les types et la période que le résultat déclare avoir couverts, dans la limite de ce que la demande prévoyait (document 06). Un joueur pour lequel aucun résultat de recherche n'a été importé est « sans backtest » ; dès qu'un résultat a été importé pour lui, il est « déjà traité » : ce sont les deux situations que le glossaire du document 00 nomme joueur non profilé et joueur profilé. La couverture inclut un type dès qu'une période au moins est couverte pour lui, quelle que soit la version de sa fiche ; c'est ce que consultent l'aiguillage après détection (BKT-30) et la fiche d'alerte (document 09). Un résultat vide couvre comme un autre (BKT-23).
- **BKT-11 [Lot 1] — Hors champ.** Ne relèvent pas d'un backtest : les faits antérieurs au premier match NBA du joueur (H-BKT-01) ; les faits qui visent l'équipe entière plutôt que le joueur (Q-06), sauf si la fiche du type le prévoit ; les types non validés ; toute statistique de match (D-27).

### Cycle de vie, échéance et rang

- **BKT-12 [Lot 1] — Contenu.** Une demande porte les informations décrites dans « Données manipulées ». Sa référence est unique, ne change jamais et figure à la fois dans le prompt et dans le résultat attendu.
- **BKT-13 [Lot 1] — États.** Une demande naît « à faire ». Elle passe à « importée » à la confirmation d'un import qui la référence (document 06) ; les imports suivants ne changent plus son état. Elle passe à « annulée » sur décision de l'utilisateur ou automatiquement (BKT-14). Une demande annulée ne redevient jamais « à faire » ; elle ne peut passer à « importée » que si l'utilisateur confirme l'import d'un résultat qui la référence (document 06). L'état « importée » est définitif.
- **BKT-14 [Lot 1] — Annulation.** L'utilisateur peut annuler une demande à faire, avec un motif facultatif. Quand le joueur passe à l'état « retiré » (document 01), sa demande à faire est annulée avec le motif « joueur retiré » ; sa mise en pause ne change rien (H-BKT-10). Quand un événement détecté rattaché est écarté (H-08), la demande demeure : elle perd seulement l'urgence liée à cet événement (BKT-18). Quand il est retiré (document 13), elle demeure de même, sans plus garder de lien vers lui. Après une annulation, un nouveau déclencheur peut créer une nouvelle demande.
- **BKT-15 [Lot 1] — Mise à jour et réduction.** Tant qu'une demande est à faire, l'utilisateur peut la mettre à jour, ce qui ajoute les types validés depuis sa création, retire ceux qui ne sont plus validés, reprend la version en vigueur de chaque fiche et porte la fin des périodes à la date du jour (H-BKT-02) ; ou la réduire, en retirant des types ou en ramenant la fin de période à la fin d'une saison choisie, notamment quand l'IA ne parvient pas à rendre une réponse complète. Le prompt est alors régénéré sous la même référence ; ce qui a été retiré sera proposé en complément après l'import (BKT-06). Tant qu'une demande à faire n'est pas mise à jour, elle signale les types dont la fiche a changé de version depuis la production de son prompt, pour que l'utilisateur le régénère avant de lancer la recherche (document 02, TAX-23).
- **BKT-16 [Lot 1] — Échéance.** Toute demande affiche le prochain match du joueur (date et heure dans le fuseau de l'utilisateur, adversaire), fourni par le document 07 (STA-26), ou, à défaut, la réponse « aucun match prévu » de ce document, avec son motif.
- **BKT-17 [Lot 1] — Rang dans la liste « à faire ».** La liste des demandes à faire (document 12) présente les demandes de la plus ancienne à la plus récente (H-BKT-04).
- **BKT-18 [Lot 2] — Urgence.** Une demande rattachée à des événements détectés affiche, pour chacun, son match mesuré (document 08) : « à venir », avec le temps restant, ou « joué », avec la mention que le backtest arrivera après coup, risque accepté (D-36). Elle est urgente tant qu'au moins un de ces événements, ni écarté ni retiré, a son match mesuré à venir ; son échéance est alors le plus proche de ces matchs à venir. Les demandes urgentes passent en tête de liste, de l'échéance la plus proche à la plus lointaine ; les autres suivent l'ordre de BKT-17 (H-BKT-04).
- **BKT-19 [Lot 1] — Quota de l'IA de recherche.** Le prompt est écrit pour toute IA de recherche approfondie capable de citer ses sources ; aucune n'est supposée. L'utilisateur l'emploie hors de l'application ; dans l'esprit de D-07 bis, il s'agit d'un accès gratuit, dont le quota limite le nombre de recherches possibles (Q-BKT-02). Quand ce quota est épuisé, les demandes restent à faire dans l'ordre de la liste, sans relance ni annulation automatique. Le volume reste borné : une demande ouverte au plus par joueur suivi, soit 20 à 30 au plus (D-17).

### Prompt de recherche

- **BKT-20 [Lot 1] — Production et copie.** Le prompt est produit à la création de la demande et conservé avec elle ; il est régénéré, sous la même référence, à chaque mise à jour ou réduction (BKT-15). La demande offre « Copier », qui place tout le texte dans le presse-papiers en un geste, et « Partager », qui ouvre la feuille de partage du téléphone (D-25). L'application note la date de la dernière copie ; si le prompt change après une copie, elle avertit que le texte copié n'est plus à jour.
- **BKT-21 [Lot 1] — Exigences du prompt.** Le prompt reprend, sans les affaiblir, les exigences du texte de référence ci-dessous : exhaustivité, y compris les événements suivis d'un mauvais match (H-01) ; aucune statistique (D-27) ; sources de presse publiques et datées, dont une au moins publiée avant le match qui a suivi (D-10) ; rien d'inventé, et aveu explicite de ce qui n'a pas pu être vérifié ; date à laquelle l'événement est devenu public, selon la règle de datation du type, et heure de publication des sources quand elle est connue ; description courte, factuelle, sans détail intime (D-20), selon les règles de formulation du document 13 (DSN-12 à DSN-23) ; contexte du match suivant (H-09), selon les définitions du document 08 (SEN-13, SEN-14) ; confiance de la recherche ; un fait par événement ; liste jamais abrégée ; réponse composée du seul JSON.
- **BKT-22 [Lot 1] — Parties variables.** Les parties variables, notées entre doubles accolades, sont toutes remplacées avant l'affichage : aucune ne doit subsister dans le texte copié. Un élément de fiche vide est remplacé par « non renseigné ».

Texte de référence du prompt :

```text
RECHERCHE APPROFONDIE — HISTORIQUE DES ÉVÉNEMENTS D'UN JOUEUR NBA
Demande émise par l'application personnelle Egoscope.
Référence de la demande : {{REFERENCE}}
Date du jour : {{DATE_DU_JOUR}}
Joueur : {{NOM_JOUEUR}} (identifiant {{IDENTIFIANT_JOUEUR}}), {{REPERE_JOUEUR}}

1. MISSION
Établis la liste exhaustive des événements qui ont pu toucher l'égo de ce joueur et qui sont devenus publics {{PERIODE}}, pour chacun des types définis au point 3, sur la période indiquée pour chaque type. Cette liste servira à une étude statistique : savoir si ce joueur joue mieux, moins bien, ou ni l'un ni l'autre après ce genre d'événement. L'étude n'a de valeur que si la liste est complète et vraie.

2. RÈGLES IMPÉRATIVES
2.1 Exhaustivité. Rapporte tous les événements qui remplissent les critères d'un type, que le joueur ait ensuite bien joué, mal joué ou pas joué. N'écarte jamais un événement à cause du match qui a suivi et ne te limite pas aux histoires marquantes : un historique trié fausserait l'étude.
2.2 Aucune statistique. Ne cherche pas, n'utilise pas et ne cite pas les statistiques ni les scores des matchs. Ils seront récupérés ailleurs, et les connaître risquerait d'orienter ton tri.
2.3 Sources. Uniquement des articles de presse publics et datés : presse sportive, presse généraliste, archives d'actualités, dans toutes les langues utiles, en particulier l'anglais. Pas de réseaux sociaux, de forums, d'encyclopédies collaboratives ni de vidéos sans article. Chaque événement retenu doit avoir au moins une source publiée avant le premier match NBA que le joueur a disputé après l'événement : retiens les sources les plus anciennes possible. Donne l'adresse exacte de l'article, jamais celle d'une page d'accueil ou d'une page de recherche. Pour chaque source, donne sa date de publication, avec l'heure et le décalage horaire quand l'article les indique.
2.4 Rien d'inventé. N'invente jamais un fait, une date, une adresse, un titre ou un média, et ne cite que des articles dont tu as constaté l'existence. Un fait que tu ne peux pas étayer ainsi, ou dont toutes les sources sont postérieures au match qui a suivi, va dans "pistes_non_verifiees", jamais dans "evenements". Ce qui reste douteux pour un événement retenu va dans son champ "non_verifie". Les saisons, types ou sources que tu n'as pas pu explorer correctement vont dans "limites". Une liste plus courte mais vraie vaut mieux qu'une liste complétée par des suppositions.
2.5 Date publique. C'est le moment où le fait est devenu public, selon la règle de datation du type (point 3) : en général la date de la première source qui le rapporte ; pour un fait connu d'avance, comme un anniversaire, le jour où il se produit. Ajoute l'heure et le décalage horaire quand une source les donne.
2.6 Discrétion. Décris chaque événement en une seule phrase factuelle et neutre, en français, de {{TEXTE_MAX}} caractères au plus : qui, désigné par son rôle, a fait quoi envers le joueur, et quel genre de média l'a rapporté. Désigne toute personne autre que le joueur par son rôle (un adversaire, un coéquipier, un entraîneur, un dirigeant, un spectateur, un proche), jamais par son nom. Résume les propos : aucune citation entre guillemets, aucune insulte recopiée. Aucun jugement de valeur, aucune interprétation des sentiments du joueur, aucun pronostic. Aucun détail intime : pour un deuil, dis seulement qu'un proche est décédé, sans nom, lien de parenté, cause, circonstances ni obsèques ; pour des propos racistes, ni les termes employés, ni l'origine, la couleur de peau, la nationalité ou la religion du joueur ; aucune information de santé (diagnostic, nature d'une blessure ou d'une maladie, traitement, santé mentale) ; rien sur la famille, la vie sentimentale, le domicile, la situation financière, les opinions ou les croyances ; pour une affaire judiciaire, dis seulement que le joueur est mis en cause publiquement, sans les faits reprochés ni les autres parties. Ces règles valent aussi pour les champs "precision" et "non_verifie", les pistes et les limites ; les titres d'articles, eux, sont recopiés tels que publiés.
2.7 Contexte. Pour le premier match NBA disputé par le joueur après l'événement, indique s'il revenait de blessure, c'est-à-dire si la presse présente ce match comme son retour, ou comme l'un de ses premiers matchs, après une absence due à une blessure, sans jamais préciser la blessure ; et si l'enjeu était fort, c'est-à-dire si l'issue de ce match décidait directement d'une qualification, d'une élimination, d'un titre ou d'un classement final. Réponds "inconnu" quand tu ne peux pas l'établir, ou quand ce match n'a pas encore été joué. Aucune statistique, aucun score.
2.8 Confiance. "haute" : au moins deux sources de médias différents, date publique certaine, critères du type clairement remplis. "moyenne" : une seule source, ou un léger doute sur la date ou sur un critère. "faible" : fait établi par une source, mais rattachement au type ou date publique incertains.
2.9 Un fait, un événement. Un fait rapporté par plusieurs articles est un seul événement, avec au plus {{SOURCES_MAX}} sources, les plus anciennes d'abord. Un fait qui semble relever de deux types est rangé sous le seul type dont la fiche lui correspond le mieux.
2.10 Hors champ. Ignore les faits devenus publics hors de la période demandée, ceux qui visent l'équipe entière plutôt que le joueur (sauf si la fiche du type le prévoit) et tout type non défini au point 3.
2.11 Longueur. N'abrège jamais la liste : ni points de suspension, ni "etc.", ni résumé. Si tout ne tient pas dans une seule réponse, traite la période dans l'ordre chronologique, arrête-toi à la fin d'une saison complète et indique dans "periode_couverte" la date de fin réellement couverte : la suite te sera demandée à part.

3. TYPES D'ÉVÉNEMENTS À RECHERCHER
{{DEBUT_BLOC_TYPE}}
Type "{{TYPE_IDENTIFIANT}}" : {{TYPE_NOM}}
Période à couvrir : {{TYPE_PERIODE}}
Définition : {{TYPE_DEFINITION}}
Critères d'inclusion : {{TYPE_INCLUSION}}
Critères d'exclusion : {{TYPE_EXCLUSION}}
Règle de datation : {{TYPE_DATATION}}
Exemple : {{TYPE_EXEMPLE}}
{{FIN_BLOC_TYPE}}

4. FORMAT DE LA RÉPONSE
Ta réponse est composée uniquement d'un objet JSON valide : pas de texte avant ni après, pas de balises de mise en forme, pas d'appels de notes ni de marqueurs de citation. Si ton outil ajoute malgré tout un rapport, le JSON complet doit figurer d'un seul tenant à la toute fin. Structure attendue, où chaque valeur décrit ce qu'il faut y mettre :
{
  "format": "egoscope-backtest",
  "version_format": "{{VERSION_FORMAT}}",
  "reference_demande": "{{REFERENCE}}",
  "joueur": { "identifiant": "{{IDENTIFIANT_JOUEUR}}", "nom": "{{NOM_JOUEUR}}" },
  "types_couverts": {{LISTE_TYPES}},
  "periode_couverte": { "debut": "AAAA-MM-JJ", "fin": "AAAA-MM-JJ" },
  "evenements": [
    {
      "type_evenement": "identifiant d'un type du point 3",
      "date_publique": "AAAA-MM-JJ, ou AAAA-MM-JJTHH:MM±HH:MM si l'heure est connue",
      "description": "une phrase factuelle en français",
      "sources": [
        {
          "lien": "adresse complète de l'article, commençant par https:// ou http://",
          "media": "nom du média",
          "titre": "titre exact de l'article, dans sa langue",
          "date_publication": "même format que date_publique"
        }
      ],
      "contexte": {
        "retour_de_blessure": "oui, non ou inconnu",
        "enjeu_du_match": "fort, normal ou inconnu",
        "precision": "facultatif : une phrase, sans statistique, score ni détail de santé"
      },
      "confiance": "haute, moyenne ou faible",
      "non_verifie": "facultatif : ce que tu n'as pas pu vérifier"
    }
  ],
  "pistes_non_verifiees": [
    {
      "type_evenement": "facultatif : identifiant d'un type du point 3",
      "periode_approximative": "facultatif : par exemple saison 2020-2021",
      "description": "une phrase factuelle en français",
      "raison": "pourquoi ce fait n'a pas pu être étayé"
    }
  ],
  "limites": ["une phrase par limite de ta recherche"]
}
Règles du format : garde dans "types_couverts" les seuls types réellement recherchés ; "periode_couverte" donne la période réellement traitée ; trie les événements par date publique croissante, tous types mélangés ; écris [] pour une liste sans contenu ; omets un champ facultatif plutôt que de le laisser vide ; n'ajoute aucun autre champ ; utilise uniquement des guillemets droits.

5. SI TU NE TROUVES RIEN
Si aucun fait ne remplit les critères, renvoie le même objet avec "evenements": []. C'est une réponse valide et utile : n'invente rien pour la remplir.

6. AVANT DE RÉPONDRE, VÉRIFIE
- que ta réponse ne contient que le JSON, complet et valide ;
- que la référence {{REFERENCE}} et l'identifiant {{IDENTIFIANT_JOUEUR}} sont recopiés à l'identique ;
- que chaque événement a au moins une source publiée avant le match NBA qui l'a suivi ;
- qu'aucun champ ne contient de statistique, de score ou de détail intime ;
- qu'aucune personne autre que le joueur n'est nommée et qu'aucune description, précision, réserve, piste ni limite ne contient de guillemets ;
- que tu n'as écarté aucun événement à cause du match qui l'a suivi.
```

Parties variables du prompt :

- `{{REFERENCE}}` : référence de la demande (BKT-12).
- `{{DATE_DU_JOUR}}` : date de production du prompt, création ou régénération, au format AAAA-MM-JJ.
- `{{NOM_JOUEUR}}` et `{{IDENTIFIANT_JOUEUR}}` : nom et identifiant du joueur suivi (document 01).
- `{{REPERE_JOUEUR}}` : « premier match NBA le AAAA-MM-JJ » si l'application connaît cette date (document 07, STA-47), sinon « date du premier match NBA à établir » ; ce repère évite la confusion avec un homonyme.
- `{{PERIODE}}` : période globale de la demande, du plus ancien début au plus récent fin des types demandés, sous la forme « du AAAA-MM-JJ au AAAA-MM-JJ inclus », ou « de son premier match NBA au AAAA-MM-JJ inclus » quand la date du premier match est inconnue.
- `{{DEBUT_BLOC_TYPE}}` et `{{FIN_BLOC_TYPE}}` : bornes du bloc répété. L'application écrit ce bloc une fois par type demandé, dans l'ordre alphabétique des identifiants, puis efface les bornes.
- `{{TYPE_IDENTIFIANT}}`, `{{TYPE_NOM}}`, `{{TYPE_DEFINITION}}`, `{{TYPE_INCLUSION}}`, `{{TYPE_EXCLUSION}}`, `{{TYPE_DATATION}}`, `{{TYPE_EXEMPLE}}` : contenu de la fiche du type validé, transmise en entier dans sa version en vigueur (document 02, TAX-33) ; la demande note cette version (TAX-23).
- `{{TYPE_PERIODE}}` : période demandée pour ce type, sous la même forme que `{{PERIODE}}`.
- `{{LISTE_TYPES}}` : liste JSON des identifiants demandés, dans le même ordre, par exemple `["approche-record", "humiliation-publique"]`.
- `{{TEXTE_MAX}}` : longueur maximale des textes libres, égale à la longueur maximale d'une description fixée par le document 13 (DSN-20).
- `{{SOURCES_MAX}}` : nombre maximal de sources par événement, 3 par défaut (paramétrable, H-BKT-09).
- `{{VERSION_FORMAT}}` : version du format de retour, « 1.0 » (BKT-24).

### Format de retour

- **BKT-23 [Lot 1] — Résultat vide.** Une recherche qui ne retient aucun événement produit un résultat valide : tous les champs obligatoires sont présents, `types_couverts` et `periode_couverte` disent ce qui a été recherché, `evenements` vaut `[]`, et `limites` dit, le cas échéant, ce qui a gêné la recherche. Importé (document 06), il compte comme un backtest à part entière : la couverture est enregistrée, la demande passe à « importée », aucun cas n'est créé, et la détection ne déclenche plus de demande automatique pour ces types (lot 2).
- **BKT-24 [Lot 1] — Version du format.** Le format défini dans « Données manipulées » porte la version 1.0 ; il est le seul contrat entre le prompt et l'import. Toute modification (champ ajouté, retiré ou renommé, valeur permise changée) crée une nouvelle version, inscrite dans le prompt ; l'import continue de lire les versions antérieures qu'il connaît (document 06).

### Limites des IA de recherche et parades

- **BKT-25 [Lot 1] — Réponse tronquée ou abrégée.** Risque : la réponse dépasse ce que l'IA peut rendre et s'arrête au milieu du JSON, ou l'IA résume la liste. Parades du prompt : liste jamais abrégée (règle 2.11) ; arrêt à la fin d'une saison complète avec déclaration de la période réellement couverte (H-BKT-12) ; textes courts et sources limitées pour réduire la taille ; événements triés par date, ce qui permet à l'import de récupérer la partie complète d'une réponse coupée (document 06). Parades de l'application : réduction de la demande (BKT-15) et complément (BKT-06).
- **BKT-26 [Lot 1] — Texte autour du JSON.** Risque : introduction, rapport, balises de code, appels de notes. Parades : le prompt exige le seul JSON, sans marqueur de citation, et, à défaut, le JSON complet d'un seul tenant à la fin ; l'import tolère cet habillage (document 06).
- **BKT-27 [Lot 1] — Sources inventées.** Risque : adresse, titre, média ou date fabriqués. Parades : interdiction explicite (règle 2.4) ; adresse exacte de l'article, titre et média qui permettent une vérification à la main ; confiance de la recherche « haute » réservée aux faits étayés par deux médias différents ; un canal, `pistes_non_verifiees`, pour ce qui ne peut pas être étayé, afin que l'IA ne soit pas poussée à combler les vides (H-BKT-11) ; contrôles simples à l'import (document 06). Aucune de ces mesures ne garantit qu'un article existe et dit ce qu'on lui prête : seule son ouverture le montre.
- **BKT-28 [Lot 1] — Historique trié.** Risque : l'IA ne rapporte que les histoires frappantes, souvent celles suivies d'un grand match (D-32). Parades : la règle 2.1 explique pourquoi l'exhaustivité compte ; la règle 2.2 interdit de regarder les statistiques ; l'aperçu d'import montre la répartition des événements par saison pour repérer les trous (document 06). L'application ne peut pas vérifier que l'IA a respecté ces règles.
- **BKT-29 [Lot 1] — Confusions et approximations.** Risque : homonyme, date estimée, fait rangé sous le mauvais type. Parades : identifiant et repère du joueur ; règle de la date publique (2.5) ; règle d'un fait par événement (2.9, H-BKT-06) ; confiance de la recherche et champ `non_verifie`.

## Données manipulées

### Demande de backtest

- **Référence** : code unique, stable et lisible, recopié dans le prompt et dans le résultat (format indicatif : « DEM-2026-0007 »).
- **Joueur** : identifiant et nom (document 01).
- **Déclencheur** : action manuelle, détection, validation, réactivation ou élargissement d'un type, ou import incomplet ; selon le cas, les événements détectés rattachés, le type concerné ou l'import d'où la demande procède.
- **Nature** : initiale (joueur sans backtest), complément, ou reprise complète.
- **Origine**, déduite du déclencheur et de la nature, telle que l'affichent les documents 11 et 12 : « née d'une détection » (déclencheur détection, demande initiale ou complément) ; « manuelle » (action manuelle, demande initiale ou reprise complète) ; « complémentaire » (tout autre complément).
- **Types demandés** : pour chacun, l'identifiant de sa fiche, la version de la fiche reprise par le prompt (document 02, TAX-23) et sa période demandée (début, fin).
- **Période globale** : du plus ancien début au plus récent fin des types demandés.
- **Prompt** : texte produit, date de production, date de la dernière copie.
- **État** : à faire, importée ou annulée, avec les dates de création, d'import et d'annulation, et le motif d'annulation.
- **Imports rattachés** et **refus restants** du dernier import (document 06).
- **Calculés à l'affichage, non conservés** : échéance (BKT-16), urgence (BKT-18) et rang dans la liste (BKT-17).

### Couverture de backtest d'un joueur

- Pour chaque type : les périodes couvertes, chacune avec l'import qui l'a apportée, sa date et la version de la fiche sous laquelle elle a été recherchée.
- Déductions : joueur « sans backtest » (non profilé) ou « déjà traité » (profilé), types non couverts, types couverts sous une version antérieure à un élargissement, premier jour non couvert de chaque type.

### Résultat de recherche — format version 1.0

Règles générales :

- Le résultat est un seul objet JSON, encodé en UTF-8. Les noms de champs s'écrivent exactement comme ci-dessous ; aucun autre champ n'est prévu.
- Dates : « AAAA-MM-JJ », ou « AAAA-MM-JJTHH:MM±HH:MM » (date, heure et décalage horaire) quand l'heure est connue ; aucun autre format n'est admis.
- Valeurs énumérées : en minuscules, telles que listées ci-dessous.
- Textes libres (description, précision, réserve `non_verifie`, textes des pistes et des limites) : en français (H-BKT-05), conformes aux règles de formulation du document 13 (DSN-12 à DSN-23), sans guillemets, et pas plus longs que la longueur maximale d'une description fixée par ce document (DSN-20).
- Un champ facultatif sans contenu est omis ; la valeur nulle n'est jamais employée.
- Le document 06 précise quels manques entraînent un refus et lesquels sont tolérés.
- Ces règles générales servent aussi de conventions au retour du prompt d'exploration de types (document 02, TAX-17), qui doit porter dans son champ `format` une autre valeur que « egoscope-backtest », pour que l'import ne le confonde jamais avec un résultat de recherche (document 06, IMP-06).

Objet racine :

- `format` — obligatoire — texte, valeur fixe « egoscope-backtest » : distingue ce résultat de tout autre JSON, par exemple celui du prompt d'exploration de types (document 02).
- `version_format` — obligatoire — texte, « 1.0 » pour la présente définition.
- `reference_demande` — obligatoire — texte : référence de la demande, recopiée du prompt ; c'est le lien entre le résultat et la demande.
- `joueur` — obligatoire — objet à deux champs obligatoires, `identifiant` et `nom`, recopiés du prompt ; ils confirment que le résultat concerne le joueur de la demande.
- `types_couverts` — obligatoire — liste non vide, sans doublon, d'identifiants de types figurant dans le prompt : les types réellement recherchés. Un type présent sans événement signifie « recherché, aucun événement trouvé » ; un type absent signifie « non recherché ».
- `periode_couverte` — obligatoire — objet à deux champs obligatoires, `debut` et `fin`, dates sans heure, `debut` antérieur ou égal à `fin` : la période réellement traitée, comprise dans la période demandée. Une fin antérieure à celle demandée signale une réponse arrêtée en cours de route (règle 2.11).
- `evenements` — obligatoire — liste, éventuellement vide (BKT-23), d'objets « événement », triée par date publique croissante, tous types mélangés.
- `pistes_non_verifiees` — obligatoire — liste, éventuellement vide, d'objets « piste » : faits entrevus mais non étayés, qui ne sont jamais comptés.
- `limites` — obligatoire — liste, éventuellement vide, de textes libres : saisons, types ou sources que la recherche n'a pas pu explorer correctement.

Événement :

- `type_evenement` — obligatoire — identifiant d'un type de `types_couverts`.
- `date_publique` — obligatoire — date, ou date et heure, à laquelle le fait est devenu public (règle 2.5) : c'est la date de référence de l'événement ; elle tombe dans la période demandée.
- `description` — obligatoire — texte libre non vide : une phrase factuelle, conforme aux règles de formulation du document 13 (DSN-19 à DSN-23), sans détail intime ni statistique (D-20, D-27).
- `sources` — obligatoire — liste de 1 à 3 objets « source » (paramètre « nombre maximal de sources par événement », paramétrable, H-BKT-09), de la plus ancienne à la plus récente ; l'une au moins est publiée avant le premier match NBA disputé par le joueur après l'événement (D-10).
- `contexte` — obligatoire — objet relatif au premier match NBA disputé par le joueur après l'événement (H-09, H-BKT-08) ; « inconnu » tant que ce match n'a pas été joué :
  - `retour_de_blessure` — obligatoire — « oui » si le joueur revenait alors de blessure au sens du document 08 (SEN-13), c'est-à-dire si la presse présente ce match comme son retour, ou comme l'un de ses premiers matchs, après une absence due à une blessure ; « non » ; ou « inconnu ». La nature de la blessure n'est jamais indiquée (document 13, DSN-07, DSN-15) ;
  - `enjeu_du_match` — obligatoire — « fort » si l'issue de ce match décidait directement d'une qualification, d'une élimination, d'un titre ou d'un classement final, définition du document 08 (SEN-14) ; « normal » sinon ; « inconnu » si la recherche ne l'établit pas. Un match de phases finales n'est donc pas « fort » du seul fait de sa phase ;
  - `precision` — facultatif — texte libre, sans statistique, score ni détail de santé. Elle aide l'utilisateur à vérifier les deux indications dans l'aperçu d'import ; elle n'est pas conservée, une indication de contexte n'étant jamais un récit (document 06 ; document 13, DSN-07).
- `confiance` — obligatoire — confiance de la recherche : « haute », « moyenne » ou « faible », selon la règle 2.8 du prompt (H-BKT-07). Elle se distingue de la confiance de détection (document 04) et de la confiance du profil (document 08). Son usage dans les calculs relève du document 08 : par défaut, un événement de confiance de la recherche « faible » est compté comme les autres, et le nombre de tels cas est affiché avec le profil (SEN-43) ; la question Q-BKT-01 reste ouverte.
- `non_verifie` — facultatif — texte libre : ce qui n'a pas pu être vérifié pour cet événement.

Source :

- `lien` — obligatoire — adresse complète de l'article lui-même, commençant par « https:// » ou « http:// » ; jamais un message de réseau social, un forum, une encyclopédie collaborative ni une vidéo sans article, que le document 13 n'admet pas comme sources (DSN-01, DSN-03).
- `media` — obligatoire — texte : nom du média.
- `titre` — obligatoire — texte : titre de l'article tel que publié, dans sa langue d'origine (H-BKT-05).
- `date_publication` — obligatoire — date, ou date et heure, de publication de l'article.

Piste non vérifiée :

- `type_evenement` — facultatif — identifiant d'un type de `types_couverts`.
- `periode_approximative` — facultatif — texte libre, par exemple « saison 2020-2021 ».
- `description` — obligatoire — texte libre, soumis aux mêmes règles de discrétion qu'une description d'événement.
- `raison` — obligatoire — texte libre : pourquoi le fait n'a pas pu être étayé.

### Exemple complet

Cet exemple est valide et conforme à la définition. Le joueur, les équipes, les médias et les faits sont fictifs ; les adresses utilisent le domaine réservé « .example », qui ne désigne aucun site réel ; les identifiants de types sont ceux que le document 02 propose pour les types candidats. La demande couvrait quatre types, du premier match NBA du joueur A (2019-10-23) au 2026-11-11 ; le type « racisme-subi » a été recherché sans qu'aucun événement soit retenu.

```json
{
  "format": "egoscope-backtest",
  "version_format": "1.0",
  "reference_demande": "DEM-2026-0007",
  "joueur": { "identifiant": "joueur-0007", "nom": "Joueur A" },
  "types_couverts": ["approche-record", "conflit-joueurs", "humiliation-publique", "racisme-subi"],
  "periode_couverte": { "debut": "2019-10-23", "fin": "2026-11-11" },
  "evenements": [
    {
      "type_evenement": "humiliation-publique",
      "date_publique": "2021-01-14T23:10-05:00",
      "description": "Après un match contre l'équipe Y, un joueur adverse se moque publiquement du joueur A en conférence de presse ; un site spécialisé le rapporte le soir même.",
      "sources": [
        {
          "lien": "https://www.site-basket.example/news/2021/01/14/rival-mocks-player-a",
          "media": "Un site spécialisé basket (fictif)",
          "titre": "Rival mocks Player A in post-game press conference",
          "date_publication": "2021-01-14T23:40-05:00"
        },
        {
          "lien": "https://www.media-national.example/basket/2021/01/15/le-joueur-a-raille",
          "media": "Un média national (fictif)",
          "titre": "Le joueur A raillé par un adversaire",
          "date_publication": "2021-01-15"
        }
      ],
      "contexte": {
        "retour_de_blessure": "non",
        "enjeu_du_match": "normal"
      },
      "confiance": "haute"
    },
    {
      "type_evenement": "conflit-joueurs",
      "date_publique": "2023-04-26",
      "description": "Altercation verbale entre le joueur A et un coéquipier de l'équipe X pendant un temps mort ; un quotidien régional la rapporte le soir même.",
      "sources": [
        {
          "lien": "https://www.quotidien-regional.example/sports/2023/04/26/tension-sur-le-banc-de-l-equipe-x",
          "media": "Un quotidien régional (fictif)",
          "titre": "Tension sur le banc de l'équipe X",
          "date_publication": "2023-04-26"
        }
      ],
      "contexte": {
        "retour_de_blessure": "non",
        "enjeu_du_match": "fort",
        "precision": "Match suivant : septième match d'une série éliminatoire."
      },
      "confiance": "moyenne",
      "non_verifie": "Une seule source trouvée ; heure de publication inconnue."
    },
    {
      "type_evenement": "approche-record",
      "date_publique": "2025-12-02",
      "description": "Un média national relève que le joueur A peut devenir, dès son prochain match, le plus jeune joueur de l'équipe X à franchir un cap historique de la franchise.",
      "sources": [
        {
          "lien": "https://www.media-national.example/basket/2025/12/02/le-joueur-a-aux-portes-d-un-record",
          "media": "Un média national (fictif)",
          "titre": "Le joueur A aux portes d'un record de l'équipe X",
          "date_publication": "2025-12-02"
        }
      ],
      "contexte": {
        "retour_de_blessure": "oui",
        "enjeu_du_match": "normal",
        "precision": "Premier match après plusieurs rencontres d'absence."
      },
      "confiance": "faible",
      "non_verifie": "Le sujet a pu être évoqué quelques jours plus tôt : la date publique reste incertaine."
    }
  ],
  "pistes_non_verifiees": [
    {
      "type_evenement": "racisme-subi",
      "periode_approximative": "saison 2020-2021",
      "description": "Un article ultérieur évoque des propos hostiles visant le joueur A lors d'un déplacement, sans en donner la date.",
      "raison": "Aucune source publiée avant le match concerné n'a été trouvée."
    }
  ],
  "limites": [
    "Saison 2019-2020 : peu d'articles accessibles, le joueur A étant alors peu médiatisé.",
    "Articles réservés aux abonnés non consultés : certains faits ont pu échapper à la recherche."
  ]
}
```

## Cas limites et erreurs

- **Date du premier match NBA inconnue** : la demande est créée ; le repère du joueur l'indique et l'IA établit elle-même le début ; l'import prend alors pour borne basse le début de la période déclarée (document 06).
- **Homonyme** : l'identifiant et le repère du joueur figurent en tête du prompt.
- **Fiche de type incomplète** : l'élément manquant est remplacé par « non renseigné » ; l'utilisateur est invité à compléter la fiche (document 02).
- **Type retiré après la copie du prompt** : ses événements ne sont pas retenus à l'import (document 06) ; la mise à jour de la demande le retire du prompt.
- **Prompt trop long pour l'IA** (nombreux types, fiches longues) : l'utilisateur réduit la demande à une partie des types ; le reste lui est proposé en complément après l'import.
- **Type dont la date se connaît d'avance**, comme l'anniversaire : la recherche doit trouver une source de presse qui en parle, ce qui peut manquer (Q-TAX-01 du document 02, Q-BKT-03).
- **Événement trop récent** : son match mesuré n'est pas encore joué ; il est rapporté avec un contexte « inconnu » et l'application le mesurera plus tard (document 08).
- **Joueur en début de carrière** : la période est courte et un résultat vide est plausible.
- **Intersaison** : l'échéance affiche « aucun match prévu » avec son motif (document 07, STA-26), ou un match lointain.
- **Fiche de type modifiée après la copie du prompt** : la demande le signale (BKT-15) ; si l'utilisateur importe quand même le résultat, ses événements prennent la version de fiche de la demande (document 02, TAX-23).
- **Plusieurs détections le même jour pour un joueur sans backtest (lot 2)** : une seule demande, à laquelle tous les événements sont rattachés.
- **Demande ancienne** : la fin de période ne bouge pas d'elle-même ; la mise à jour la porte à la date du jour.
- **« Compléter » alors que la couverture est complète jusqu'à la date du jour** : l'application l'indique et propose « refaire ».
- **Résultat rapporté pour une demande annulée** : l'import le traite après confirmation (document 06).

## Critères d'acceptation

1. **BKT-01, BKT-08, BKT-22** — **Étant donné** le joueur A, actif, sans backtest, dont le premier match NBA est connu, et trois types validés, **quand** l'utilisateur touche « Demander un backtest », **alors** une demande « à faire » est créée avec une référence unique, les trois types, chacun du premier match NBA du joueur à la date du jour, et un prompt où ne subsiste aucune partie variable.
2. **BKT-02** — **Étant donné** qu'aucun type n'est validé, **quand** l'utilisateur demande un backtest, **alors** aucune demande n'est créée et l'application explique qu'il faut d'abord valider un type.
3. **BKT-07** — **Étant donné** une demande à faire pour le joueur A, **quand** l'utilisateur demande de nouveau un backtest pour A, **alors** aucune demande n'est créée et la demande existante s'affiche.
4. **BKT-03** — **Étant donné** le joueur A, actif, sans backtest ni demande à faire, **quand** un événement est détecté pour lui (lot 2), **alors** une demande initiale, déclenchée par la détection, est créée et rattachée à l'événement, la notification « demande de backtest à faire » est déclenchée, et la demande est urgente.
5. **BKT-07, BKT-18** — **Étant donné** une demande à faire pour le joueur A, **quand** un second événement est détecté pour A (lot 2), **alors** aucune demande n'est créée, l'événement est rattaché à la demande existante, et son échéance et son rang sont recalculés.
6. **BKT-05** — **Étant donné** les joueurs A et B déjà traités et le joueur C sans backtest, **quand** le type T est validé, **alors** l'application propose, pour A et pour B seulement, un complément limité au type T sur toute la carrière, et n'en crée aucun sans accord.
7. **BKT-09** — **Étant donné** le joueur A couvert pour tous les types validés jusqu'au 2025-06-30, **quand** l'utilisateur choisit « compléter » le 2026-11-11, **alors** chaque type est demandé du 2025-07-01 au 2026-11-11.
8. **BKT-06** — **Étant donné** une demande créée le 2026-11-11 et un résultat dont la période couverte s'arrête au 2022-06-30, **quand** l'import est confirmé le même jour, **alors** le bilan propose un complément du 2022-07-01 au 2026-11-11 pour les types demandés.
9. **BKT-14** — **Étant donné** une demande à faire pour le joueur A, **quand** A passe à l'état « retiré », **alors** la demande passe à « annulée » avec le motif « joueur retiré ».
10. **BKT-15, BKT-20** — **Étant donné** une demande à faire dont le prompt a été copié, **quand** l'utilisateur la réduit à la fin de la saison 2022-2023, **alors** le prompt est régénéré sous la même référence et l'application avertit que le texte copié n'est plus à jour.
11. **BKT-18** — **Étant donné** une demande née d'une détection dont le match mesuré a été joué (lot 2), **quand** l'utilisateur l'ouvre, **alors** elle affiche « joué » et la mention que le backtest arrivera après coup, et elle n'est plus urgente.
12. **BKT-21** — **Étant donné** un prompt produit par l'application, **quand** on le relit, **alors** on y trouve chacune des exigences de BKT-21, dont la consigne de ne répondre que par le JSON, les règles de formulation du document 13 (DSN-12 à DSN-23), les définitions du retour de blessure et de l'enjeu du match du document 08 (SEN-13, SEN-14) et, pour chaque type, sa règle de datation.
13. **BKT-24** — **Étant donné** l'exemple complet de ce document, **quand** on le soumet à un contrôle de syntaxe JSON et qu'on le confronte, champ par champ, à la définition du format, **alors** il est valide et conforme.
14. **BKT-23** — **Étant donné** un résultat valide dont la liste des événements est vide, **quand** il est importé, **alors** la demande passe à « importée », la couverture est enregistrée pour les types et la période déclarés, aucun cas n'est créé, et aucune demande automatique ne naît plus pour ces types (lot 2).
15. **BKT-30, BKT-04** — **Étant donné** le joueur B, profilé, dont la couverture n'inclut pas le type T et qui n'a pas de demande à faire, **quand** un événement de type T est détecté pour lui (lot 2), **alors** une fiche d'alerte portant la mention « type non couvert par le backtest » est demandée, un complément portant sur les types validés non couverts est créé sans notification séparée, et l'événement est suivi.
16. **BKT-15** — **Étant donné** une demande à faire dont le prompt reprend la version 1 de la fiche du type T, **quand** une modification de fond crée la version 2, **alors** la demande signale que son prompt repose sur une version antérieure ; **quand** l'utilisateur la met à jour, **alors** le prompt est régénéré sous la même référence avec la version 2, et la demande la note.
17. **BKT-16** — **Étant donné** une demande à faire pour un joueur dont l'équipe est éliminée, **quand** l'utilisateur l'ouvre, **alors** l'échéance affiche « aucun match prévu » avec le motif « équipe éliminée ».

## Dépendances

- [00 — Vue d'ensemble](00-vue-d-ensemble.md) : glossaire, objets métier, lots.
- [01 — Joueurs suivis](01-joueurs-suivis.md) : identifiant, nom et état du joueur ; action « Demander un backtest » sur sa fiche ; passage à « retiré ».
- [02 — Taxonomie des événements](02-taxonomie-des-evenements.md) : types validés ; pour chacun, un identifiant court et stable, un nom, une définition, des critères d'inclusion et d'exclusion, une règle de datation, un exemple, transmis en entier (TAX-33) ; version de fiche (TAX-23) ; signal de validation, de réactivation ou d'élargissement d'un type (TAX-20, TAX-24, TAX-32) ; identifiants des types candidats ; Q-TAX-01.
- [04 — Détection des événements](04-detection-des-evenements.md) : événement détecté, son type et son état ; besoins de backtest signalés au lot 2 et même aiguillage (DET-38 à DET-40).
- [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) : lecture du format, passage à « importée », enregistrement de la couverture, proposition de complément, précision du contexte montrée sans être conservée.
- [07 — Statistiques de match](07-statistiques-de-match.md) : prochain match du joueur ou « aucun match prévu » (STA-26), date de son premier match NBA (STA-47), saisons (STA-48).
- [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) : match mesuré d'un événement ; définitions du retour de blessure et de l'enjeu du match (SEN-13, SEN-14) ; usage du contexte et de la confiance de la recherche (Q-BKT-01).
- [09 — Fiche d'alerte](09-fiche-d-alerte.md) : fiche d'alerte d'un joueur profilé, avec la mention « type non couvert par le backtest » le cas échéant (BKT-30).
- [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) : suivi des événements détectés, avec ou sans backtest.
- [11 — Notifications Telegram](11-notifications-telegram.md) : notification « demande de backtest à faire » ; annonce d'un complément né d'une détection dans le message d'alerte (TEL-11).
- [12 — Interface et accès](12-interface-et-acces.md) : liste « à faire », écran de la demande, copie et partage, origine affichée.
- [13 — Données sensibles](13-donnees-sensibles.md) : ce qui ne doit jamais être demandé ni stocké ; règles de formulation reprises par le prompt (DSN-12 à DSN-23) ; forme fermée du contexte (DSN-07) ; sources admises (DSN-01, DSN-03) ; longueur maximale d'une description (DSN-20).
- [14 — Exigences transverses](14-exigences-transverses.md) : gestion des paramètres.
- [90 — Journal des décisions](90-journal-des-decisions.md) : source de vérité.

## Hypothèses et questions ouvertes

Renvois au journal :

- H-01, H-02, H-05, H-06, H-07, H-08, H-09, H-11 et H-12 sont appliquées telles quelles et restent, comme toute hypothèse du journal, à confirmer. Le déclenchement manuel du lot 1 (BKT-01) vient de H-12 et non de D-36, qui prévoit des backtests demandés au fil des détections.
- Q-02 : aucun outil de recherche n'est nommé ; le prompt vise toute IA de recherche approfondie.
- Q-06 : les événements d'équipe sont hors du backtest, sauf si une fiche de type le prévoit.
- D-36 : le risque d'un backtest prêt après le match est accepté et affiché (BKT-18).

Hypothèses locales, toutes à confirmer :

- **H-BKT-01 — Début de carrière.** La carrière NBA commence au premier match NBA officiel du joueur, date fournie par le document 07 ; les faits antérieurs (soirée de la draft, présaison) sont hors champ. *À confirmer.*
- **H-BKT-02 — Types figés.** Les types d'une demande sont ceux validés à sa création ; seule une mise à jour décidée par l'utilisateur en ajoute (lecture de H-05). *À confirmer.*
- **H-BKT-03 — Complément à la détection.** Au lot 2, la détection d'un événement d'un type non couvert crée automatiquement un complément pour un joueur déjà traité, ce qui étend D-24 du joueur au type ; ce complément n'a pas de notification propre, le message d'alerte l'annonce (document 11). *À confirmer.*
- **H-BKT-04 — Rang.** Demandes urgentes d'abord, de l'échéance la plus proche à la plus lointaine, puis les autres de la plus ancienne à la plus récente. *À confirmer.*
- **H-BKT-05 — Langue.** Textes libres rédigés en français ; titres d'articles laissés dans leur langue d'origine. *À confirmer.*
- **H-BKT-06 — Un fait, un événement.** Un fait relevant de deux types n'est rangé que sous le type le mieux adapté, comme le veut TAX-06 du document 02 ; la détection applique la même règle (document 04, DET-27). *À confirmer.*
- **H-BKT-07 — Échelle de la confiance de la recherche.** Trois niveaux, haute, moyenne et faible, définis par la règle 2.8 du prompt ; cette confiance ne se confond ni avec la confiance de détection (document 04) ni avec la confiance du profil (document 08). *À confirmer.*
- **H-BKT-08 — Valeurs du contexte.** « oui, non, inconnu » pour le retour de blessure et « fort, normal, inconnu » pour l'enjeu ; les définitions sont celles du document 08 (SEN-13, SEN-14), que le prompt reprend ; les documents 04 et 08 emploient les mêmes valeurs. *À confirmer.*
- **H-BKT-09 — Valeurs par défaut des paramètres.** Nombre maximal de sources par événement : 3, paramétrable. La longueur maximale des textes libres est celle d'une description, fixée par le document 13 (DSN-20). *À confirmer.*
- **H-BKT-10 — Annulation au retrait.** Le passage du joueur à « retiré » annule sa demande à faire ; la mise en pause ne change rien. *À confirmer.*
- **H-BKT-11 — Pistes et limites.** L'IA déclare les faits non étayés et les zones mal explorées plutôt que de les taire ou de les inventer ; leur conservation est réglée par le document 06, au regard du document 13. *À confirmer.*
- **H-BKT-12 — Réponse arrêtée en fin de saison.** Quand tout ne tient pas dans une réponse, l'IA s'arrête à la fin d'une saison complète et déclare la période couverte ; la suite fait l'objet d'un complément. *À confirmer.*

Questions ouvertes locales :

- **Q-BKT-01 — Poids de la confiance de la recherche.** Faut-il exclure des calculs les événements de confiance de la recherche « faible », ou les compter comme les autres ? Par défaut, ils sont comptés comme les autres et leur nombre est affiché avec le profil (document 08, SEN-43, H-SEN-16, à confirmer). À trancher avec le document 08.
- **Q-BKT-02 — IA de recherche gratuite.** Quelle IA de recherche approfondie, accessible gratuitement, l'utilisateur emploiera-t-il, et combien de recherches son quota permet-il par mois ? La réponse dit si 20 à 30 premiers backtests, puis les compléments, sont réalistes.
- **Q-BKT-03 — Types connus d'avance.** Renvoi à la question Q-TAX-01 du document 02, qui la porte : faut-il repérer l'anniversaire et le match contre l'ancienne équipe par la presse, ou les déduire du calendrier ? Ce qui est propre au présent document : tant qu'elle n'est pas tranchée, le prompt traite ces types comme les autres et exige une source de presse publiée avant le match, au risque de ne retrouver que les cas médiatisés ; si elle l'est en faveur du calendrier, ces types sortent du prompt et de la couverture des backtests.
