// 日本語の文言。形は`en.ts`（正本）に合わせる。抜け・余り・引数の不一致はtypecheckで落ちる。
import type { LocaleStrings } from "./en";

export const ja = {
  commands: {
    openDashboard: "ダッシュボードを開く",
    openSettings: "設定を開く",
    publish: "反映",
    publishNote: "このノートだけ反映",
    insertFrontmatter: "Front Matterを挿入",
    pickThumbnail: "サムネイル画像を選択",
    pickCover: "カバー画像を選択",
    publishToNekoteBlog: "Nekote Blogへ反映",
    fileMenuPublishNote: "Nekote Blog: このノートだけ反映",
    fileMenuPickThumbnail: "Nekote Blog: サムネイル画像を選択",
    fileMenuPickCover: "Nekote Blog: カバー画像を選択",
  },

  publishMenu: {
    notConnected: "ブログと未接続です",
    contentRootNotSelected: "コンテンツルートが未設定です",
    fileMenuNotConnected: "Nekote Blog: ブログと未接続です",
  },

  notices: {
    alreadyPublishing: "Nekote Blog: すでに反映を実行しています。",
    connectFirst: "Nekote Blog: 先に設定画面からブログと接続してください。",
    frontmatterInserted: "Nekote Blog: Front Matterを挿入しました。",
    frontmatterAlreadyPresent: "Nekote Blog: Front Matterは挿入済みです。",
    frontmatterInsertFailed: "Nekote Blog: Front Matterを挿入できませんでした。",
    openSettingsManually:
      "Nekote Blog: 設定 → コミュニティプラグイン → Nekote Blogから設定を開いてください。",
  },

  settings: {
    authorization: {
      heading: "承認を待っています",
      starting: "接続を開始しています…",
      checkCode:
        "ブラウザで開いたページに次のコードが表示されていることを確認して、承認してください。",
      approvalPage: "承認ページ",
      openAgain: "もう一度開く",
      cancel: "キャンセル",
    },
    connection: {
      heading: "接続",
      intro: "Nekote Blogのアカウントとブログが必要です。接続するとブラウザで承認画面が開きます。",
      deviceName: "端末名",
      deviceNameDesc: "承認画面とダッシュボードの端末一覧に表示されます。",
      connect: "Nekote Blogと接続",
      connectDesc: "この端末だけの接続です。別の端末では改めて接続します。",
      connectButton: "接続",
      connectedBlog: "接続先のブログ",
      connectedBlogUnknown: "接続情報を取得できていません。",
      blog: (title: string, subdomain: string) => `${title}（${subdomain}.nekote.blog）`,
      thisDevice: "この端末",
      thisDeviceUnknown: "不明",
      status: "接続状態",
      refreshButton: "最新の状態を確認",
      disconnect: "接続を解除",
      disconnectDesc:
        "この端末からは反映できなくなります。公開中の記事はそのまま残ります。再び反映するには接続し直します。",
      disconnectButton: "解除",
    },
    status: {
      notChecked: "未確認",
      noSource: "記事ソース未設定（初回の反映で接続されます）",
      otherSource: (type: string) =>
        `別のソース（${type}）が接続中です。初回の反映で切り替わります。`,
      obsidianSource: (revision: number, contentRoot: string) =>
        `Obsidianソース接続中 / revision ${revision} / コンテンツルート${contentRoot}`,
    },
    content: {
      heading: "記事",
      contentRoot: "コンテンツルート",
      contentRootDesc:
        "公開の起点にするフォルダです。直下の posts/ が記事、pages/ が固定ページになります。選ぶまで反映できません。",
      contentRootNotSelected: "（未選択）",
      imageImportFolder: "画像の取り込み先",
      imageImportFolderDesc:
        "サムネイル・カバー画像の選択で「画像ファイルを取り込む…」を選んだときの保存先フォルダです。",
      imageImportFolderDefault: "コンテンツルート直下の assets（既定）",
      folderNotFound: (path: string) => `${path}（見つかりません）`,
      autoInsertFrontmatter: "新規ノートにFront Matterを自動挿入",
      autoInsertFrontmatterDesc:
        "posts・pagesの中に作った空のノートや、外から移してきたノートへ、公開用のFront Matter（draft: trueなど）を自動で足します。足りないキーだけ足し、すでにある値は変えません。",
    },
    publishing: {
      heading: "公開",
      lastPublish: "最終反映",
      lastPublishNever: "まだ反映していません。",
      lastPublishAt: (dateTime: string, revision: number) => `${dateTime}（revision ${revision}）`,
      publish: "Nekote Blogへ反映",
      publishDesc:
        "コンテンツルートのposts/・pages/にあるノートと、そのノートが参照するファイルを送ります。送る前に内容を確認できます。",
      publishButton: "反映",
    },
    advanced: {
      heading: "詳細",
      server: "接続先",
      serverLocked: "接続中は変更できません。変更するには一度接続を解除してください。",
      production: "本番",
      staging: "staging（検証用）",
    },
    notices: {
      connected: (blogTitle: string) => `Nekote Blog: ${blogTitle} と接続しました。`,
      denied: "Nekote Blog: 承認が拒否されました。",
      expired: "Nekote Blog: 承認の有効期限が切れました。もう一度お試しください。",
      connectionRefreshed: "Nekote Blog: 接続状態を更新しました。",
      disconnected: "Nekote Blog: 接続を解除しました。",
      disconnectedButNotRevoked: (reason: string) =>
        `Nekote Blog: この端末の接続情報は削除しましたが、サーバー側の解除に失敗しました（${reason}）。ダッシュボードの端末一覧から解除してください。`,
      unknownReason: "原因不明",
      unexpectedError: "予期しないエラーが発生しました。しばらく待ってからお試しください。",
    },
  },

  publish: {
    selectContentRootFirst: "先に設定画面でコンテンツルートを選んでください。",
    checkingConnection: "接続を確認しています…",
    checkingPreviousPublish: "前回の反映の状況を確認しています…",
    readingNotes: "ノートを読んでいます…",
    readingAssets: "参照アセットを読んでいます…",
    cancelled: "反映をキャンセルしました。",
    vaultRoot: "（vaultのルート）",
    quotedPath: (path: string) => `「${path}」`,
    blog: (title: string, subdomain: string) =>
      `反映先のブログ: ${title}（${subdomain}.nekote.blog）`,
    scanConfirm: {
      noteTitle: "ノートが多いので確認します",
      assetTitle: "参照アセットが多いので確認します",
      noteAmount: (contentRoot: string, count: number, size: string) =>
        `コンテンツルート${contentRoot}のノートは${count}件・${size}です。`,
      assetAmount: (contentRoot: string, count: number, size: string) =>
        `コンテンツルート${contentRoot}の参照アセットは${count}件・${size}です。`,
      noteWarning:
        "このまま続けると、これらのノートを読み取ります。コンテンツルートの指定が正しいか確認してください。",
      assetWarning: "このまま続けると、これらのアセットを読み取ります。",
      confirmLabel: "続ける",
    },
    confirmPublish: {
      title: "Nekote Blogへ反映します",
      summary: (
        noteCount: number,
        publishedCount: number,
        draftCount: number,
        assetCount: number,
        contentRoot: string,
      ) =>
        `コンテンツルート${contentRoot}のノート${noteCount}件（公開${publishedCount}件・下書き${draftCount}件）・参照アセット${assetCount}件を反映します。`,
      note: "変更のないファイルは送信されません。前回の反映から消えたノートはブログからも削除されます。",
      confirmLabel: "反映する",
    },
    partial: {
      needsFullPublish:
        "Nekote Blog: 先に全体を反映してください。1件だけの反映はそのあとで使えます。",
      contentRootChanged:
        "Nekote Blog: コンテンツルートが変わっています。先に「Nekote Blogへ反映」で全体を反映してください。",
      notAllowed:
        "Nekote Blog: この状態ではこのノートだけの反映はできません。「Nekote Blogへ反映」で全体を反映してください。",
      confirm: {
        title: "このノートだけ反映します",
        summary: (title: string, path: string, assetCount: number) =>
          `「${title}」（${path}）と参照アセット${assetCount}件だけを反映します。`,
        draftNote: "このノートは下書きなので、ブログでは非公開になります。",
        note: "他の記事はそのままです。移動・改名・削除はこの操作では反映されません。「Nekote Blogへ反映」で全体を反映してください。",
        confirmLabel: "このノートだけ反映する",
      },
      anotherDevice: {
        detail:
          "他の端末が反映しています。このノートはその上に重ねて反映され、他の記事は変わりません。この端末を最新にするには、vaultを同期してから「Nekote Blogへ反映」を実行してください。",
        confirmLabel: "このノートだけ反映する",
      },
      preflightCounts: (added: number, updated: number, unchanged: number, untouched: number) =>
        `記事: 追加 ${added}件 / 更新 ${updated}件 / 変更なし ${unchanged}件 / 今回載せない ${untouched}件`,
      reportApplied: (revision: number) => `このノートを反映しました（revision ${revision}）`,
      untouched: (count: number) => `他の${count}件はそのままです。`,
    },
    sameVault: {
      title: "接続済みのvaultとして扱いますか？",
      intro: "このブログにはすでにObsidianのvaultが接続されています。",
      detail: (revision: number) =>
        `この端末のvaultを同じvaultとして扱うと、続きのrevision（現在 ${revision}）から反映します。別のvaultなら、ここでキャンセルしてください。`,
      serverContentRoot: "サーバーのコンテンツルート",
      confirmLabel: "同じvaultとして続ける",
    },
    differentVault: {
      title: "接続されているvaultと違います",
      intro:
        "このブログには別のvaultが接続されています。この端末のvaultで反映すると、既存の記事をすべて削除してから、このvaultの内容で作り直します。",
      warning: "作り直しの途中で失敗すると、記事が一時的に空になります。",
      confirmLabel: "このvaultで置き換える",
    },
    contentRootChange: {
      title: "コンテンツルートを変更します",
      detail: (from: string, to: string) => `公開の起点を${from}から${to}へ変えます。`,
      warning: "新しい起点にないノートは、公開中の記事から削除されます。",
      confirmLabel: "変更して続ける",
    },
    overwrite: {
      publishedFromAnotherDevice: "他の端末から反映されています",
      anotherPublishApplied: "他の反映が先に適用されています",
      revisionMismatch: (revision: number) =>
        `Nekote Blogの現在のrevisionは ${revision} で、この端末の記録と違います。`,
      warning:
        "このまま続けると、いまのvaultの内容で公開中の記事を置き換えます。他の端末の変更を残したい場合は、先にvaultを同期してからやり直してください。",
      added: (count: number) => `追加 ${count}件`,
      updated: (count: number) => `更新 ${count}件`,
      deleted: (count: number) => `削除 ${count}件`,
      confirmLabel: "このvaultの内容で上書きする",
    },
    reasons: {
      initialConnect: "このブログへの初めての反映です。",
      sourceSwitch: "別の記事ソースからObsidianへ切り替えます。既存の記事は作り直されます。",
      contentRootChanged: "コンテンツルートが変わります。",
      largeDelete: "削除される記事が多くあります。",
      largeChange: "追加・更新される記事が多くあります。",
      largeUpload: "送信するファイルの量が多くなります。",
      unknown: "内容の確認が必要です。",
    },
    preflight: {
      initialTitle: "初めての反映を確定します",
      title: "反映の内容を確認してください",
      articles: (publishedCount: number, draftCount: number) =>
        `公開 ${publishedCount}件 / 下書き ${draftCount}件`,
      draftPrefix: "［下書き］",
      article: (title: string, path: string) => `${title}（${path}）`,
      counts: (added: number, updated: number, deleted: number, unchanged: number) =>
        `記事: 追加 ${added}件 / 更新 ${updated}件 / 削除 ${deleted}件 / 変更なし ${unchanged}件`,
      filesToSend: (count: number, size: string) => `送信するファイル: ${count}件・${size}`,
      confirmLabel: "反映する",
    },
    report: {
      applied: (revision: number) => `反映しました（revision ${revision}）`,
      failed: "反映できませんでした",
      failedDetail: "公開中の記事はそのまま残っています。原因を直して、もう一度実行してください。",
      applying: "Nekote Blogで反映しています",
      applyingDetail:
        "送信は終わりました。反映の完了はもう一度「Nekote Blogへ反映」を実行すると確認できます。",
      stopped: "反映を中止しました",
      stoppedDetail: "公開中の記事は変わっていません。",
    },
    modeMismatch:
      "サーバーが反映モードを確認できなかったため、何も送っていません。プラグインを更新するか、「Nekote Blogへ反映」で全体を反映してください。",
    pushInProgress:
      "前の反映がサーバー側でまだ処理中です。少し待ってからもう一度実行してください。",
    unexpectedError: "Nekote Blog: 予期しないエラーが発生しました。",
  },

  push: {
    begin: "反映の内容を確認しています…",
    upload: "ファイルを送信しています…",
    finalize: "送信内容を確認しています…",
    apply: "Nekote Blogで反映しています…",
  },

  scan: {
    tooManyMarkdown: (count: number, limit: number) =>
      `公開対象のMarkdownが${count}件あり、上限の${limit}件を超えています。`,
    markdownTooLarge: (limit: string, path: string) =>
      `Markdownが上限（${limit}）を超えています: ${path}`,
    tooManyAssets: (count: number, limit: number) =>
      `参照アセットが${count}件あり、上限の${limit}件を超えています。`,
    assetTooLarge: (limit: string, path: string) =>
      `アセットが上限（${limit}）を超えています: ${path}`,
    caseCollision: (first: string, second: string) =>
      `大文字小文字だけが違うパスは同時に扱えません。どちらかの名前を変えてください: ${first} / ${second}`,
    normalizationCollision: (first: string, second: string) =>
      `Unicodeの正規化で同じ名前になるファイルが2つあります。どちらかの名前を変えてください: ${first} / ${second}`,
    unsupportedPathCharacters: (path: string) => `パスに使えない文字が含まれています: ${path}`,
    notPublishTarget: (path: string) => `このノートは公開対象ではありません: ${path}`,
    unreadable: (path: string) =>
      `ファイルを読み取れませんでした。クラウド同期が終わっていない可能性があります。すべてのファイルを端末へダウンロードしてから、もう一度実行してください。対象: ${path}`,
    vaultChanged:
      "反映の途中でvaultの内容が変わりました。もう一度「Nekote Blogへ反映」を実行してください。",
  },

  normalize: {
    nestedCallout: "入れ子のコールアウトは通常の引用として表示しました。",
    unsupportedCalloutType: (identifier: string) =>
      `対応していないコールアウトの種類「${identifier}」は「note」として表示しました。`,
    noteEmbed: "ノートの埋め込みは展開せず、リンクにしました。",
    unresolvedLink: (linkpath: string) => `リンク先を解決できませんでした: ${linkpath}`,
    unresolvedHeading: (heading: string) => `見出しへのリンクを解決できませんでした: ${heading}`,
    unusablePathCharacters: (path: string) =>
      `パスに使えない文字が含まれるため参照を落としました: ${path}`,
    blockReferenceTextOnly: "ブロック参照は表示できないため文字だけを残しました。",
    blockReferenceToTop: "ブロック参照は記事の先頭へのリンクになりました。",
    unpublishedNoteLink: (path: string) =>
      `公開対象外のノートへのリンクは文字だけを残しました: ${path}`,
    svgTextOnly: (path: string) => `SVGは公開できないため文字だけを残しました: ${path}`,
    unsupportedFormatTextOnly: (path: string) =>
      `対応していない形式のファイルは文字だけを残しました: ${path}`,
    ignoredOption: (option: string) =>
      `リンクの「#」以降の指定はNekote Blogでは表せないため無視しました: ${option}`,
    imageSizeIgnored: "画像のサイズ指定は無視されます。",
    outsideVault: (text: string) => `vaultの外を指す参照は取り込めません: ${text}`,
    referencedFileNotFound: (path: string) => `本文が参照するファイルが見つかりません: ${path}`,
    svgDropped: (path: string) => `SVGは公開できないため参照を落としました: ${path}`,
    tooManyAssets: (limit: number) =>
      `本文が参照するアセットが${limit}件を超えています。減らしてください。`,
    assetLimitReached: "参照アセットが上限に達したため、Front Matterの画像を省略しました。",
    frontmatterImageUnusableUrl: (key: string) =>
      `Front Matterの${key}は相対パスかhttpsのURLで指定してください。省略しました。`,
    frontmatterImageUnresolved: (key: string, value: string) =>
      `Front Matterの${key}の画像を解決できません。省略しました: ${value}`,
    frontmatterImageNotRaster: (key: string, value: string) =>
      `Front Matterの${key}にはPNG・JPG・JPEG・GIF・WebP・AVIFの画像を指定してください。省略しました: ${value}`,
    frontmatterImageNotFound: (key: string, path: string) =>
      `Front Matterの${key}の画像が見つかりません。省略しました: ${path}`,
    frontmatterUnreadable: "Front Matterを読み取れませんでした。",
  },

  frontmatter: {
    missingClosingDelimiter: "Front Matterを閉じる区切り（---）がありません。",
    mustBeString: (key: string) => `Front Matterの${key}は文字列で指定してください。`,
    invalidYaml: "Front MatterのYAMLを解釈できませんでした。",
    mustBeMapping: "Front Matterはキーと値の並びで書いてください。",
    draftMustBeBoolean: "Front Matterのdraftはtrueかfalseで指定してください。",
  },

  api: {
    unreadableResponse: "サーバーの応答を解釈できませんでした。",
    emptyResponse: "サーバーの応答が空でした。",
    unsupportedVersion:
      "このバージョンのプラグインには対応していません。プラグインを更新してください。",
    unauthorized: "接続が無効です。Obsidianの設定画面から接続し直してください。",
    unreachable: "Nekote Blogへ接続できませんでした。通信状況を確認してください。",
    httpError: (status: number) => `サーバーからエラーが返りました（HTTP ${status}）。`,
  },

  connection: {
    unreachable: "サーバーへ接続できませんでした。",
  },

  vault: {
    unreadableFile: (path: string) => `ファイルを読み取れませんでした: ${path}`,
  },

  confirmModal: {
    cancel: "キャンセル",
  },

  reportModal: {
    needAttention: (count: number) => `確認が必要な記事 ${count}件`,
    messages: "サーバーからのエラー・警告",
    error: "エラー",
    warning: "警告",
    article: (title: string, path: string) => `${title}（${path}）`,
  },

  imageModal: {
    importItem: "画像ファイルを取り込む…",
    unsupportedFormat: "Nekote Blog: 対応形式はPNG・JPG・JPEG・GIF・WebP・AVIFです。",
    importFailed: "Nekote Blog: 画像を取り込めませんでした。",
    thumbnail: {
      placeholder: "サムネイルにする画像を選ぶ…",
      applied: "Nekote Blog: サムネイルを設定しました。",
      failed: "Nekote Blog: サムネイルを設定できませんでした。",
    },
    cover: {
      placeholder: "カバー画像にする画像を選ぶ…",
      applied: "Nekote Blog: カバー画像を設定しました。",
      failed: "Nekote Blog: カバー画像を設定できませんでした。",
    },
  },

  list: {
    andMore: (count: number) => `ほか ${count}件`,
  },
} satisfies LocaleStrings;
