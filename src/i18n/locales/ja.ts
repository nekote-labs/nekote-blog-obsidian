// 日本語の文言。形は`en.ts`（正本）に合わせる。抜け・余り・引数の不一致はtypecheckで落ちる。
import type { LocaleStrings } from "./en";

export const ja = {
  commands: {
    openSettings: "設定を開く",
    publish: "Nekote Blogへ反映",
    insertFrontmatter: "フロントマターを挿入",
    pickThumbnail: "サムネイル画像を選択",
    pickCover: "カバー画像を選択",
    publishToNekoteBlog: "Nekote Blogへ反映",
    fileMenuPickThumbnail: "Nekote Blog: サムネイル画像を選択",
    fileMenuPickCover: "Nekote Blog: カバー画像を選択",
  },

  notices: {
    alreadyPublishing: "Nekote Blog: すでに反映を実行しています。",
    connectFirst: "Nekote Blog: 先に設定画面からブログと接続してください。",
    frontmatterInserted: "Nekote Blog: フロントマターを挿入しました。",
    frontmatterAlreadyPresent: "Nekote Blog: フロントマターは挿入済みです。",
    frontmatterInsertFailed: "Nekote Blog: フロントマターを挿入できませんでした。",
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
      cancel: "中止",
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
        "この端末のトークンを失効させます。公開中の記事はそのまま残ります。再び反映するには接続し直します。",
      disconnectButton: "解除",
    },
    status: {
      notChecked: "未確認",
      noSource: "コンテンツソース未設定（初回の反映で接続されます）",
      otherSource: (type: string) =>
        `別のソース（${type}）が接続中です。初回の反映で切り替わります。`,
      obsidianSource: (revision: number, contentRoot: string) =>
        `Obsidianソース接続中 / revision ${revision} / コンテンツルート「${contentRoot}」`,
    },
    contentLocation: {
      heading: "記事を置く場所",
      contentRoot: "コンテンツルート",
      contentRootDesc:
        "公開の起点にするフォルダです。直下の posts/ が記事、pages/ が固定ページになります。選ぶまで反映できません。",
      contentRootNotSelected: "（未選択）",
      imageImportFolder: "画像の取り込み先",
      imageImportFolderDesc:
        "サムネイル・カバーの「画像ファイルを取り込む…」で保存するフォルダです。",
      imageImportFolderDefault: "コンテンツルート直下の assets（既定）",
      folderNotFound: (path: string) => `${path}（見つかりません）`,
    },
    publishing: {
      heading: "公開",
      autoInsertFrontmatter: "新規ノートにフロントマターを自動挿入",
      autoInsertFrontmatterDesc:
        "posts・pages配下に作った空のノートへ、公開用のフロントマター（draft: trueなど）を最初から入れます。",
      lastPublish: "最終反映",
      lastPublishNever: "まだ反映していません。",
      lastPublishAt: (dateTime: string, revision: number) => `${dateTime}（revision ${revision}）`,
      publish: "Nekote Blogへ反映",
      publishDesc: "いまのvaultの内容を送ります。送る前に内容を確認できます。",
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
        `Nekote Blog: この端末の情報は削除しましたが、サーバー側の失効に失敗しました（${reason}）。ダッシュボードの端末一覧から失効させてください。`,
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
    cancelled: "反映を取り消しました。",
    vaultRoot: "（vaultのルート）",
    blog: (title: string, subdomain: string) =>
      `反映先のブログ: ${title}（${subdomain}.nekote.blog）`,
    scanConfirm: {
      noteTitle: "ノートが多いので確認します",
      assetTitle: "参照アセットが多いので確認します",
      noteAmount: (contentRoot: string, count: number, size: string) =>
        `コンテンツルート「${contentRoot}」のノートは${count}件・${size}です。`,
      assetAmount: (contentRoot: string, count: number, size: string) =>
        `コンテンツルート「${contentRoot}」の参照アセットは${count}件・${size}です。`,
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
        `コンテンツルート「${contentRoot}」のノート${noteCount}件（公開${publishedCount}件・下書き${draftCount}件）・参照アセット${assetCount}件を反映します。`,
      note: "変更のないファイルは送信されません。前回の反映から消えたノートはブログからも削除されます。",
      confirmLabel: "反映する",
    },
    sameVault: {
      title: "接続済みのvaultとして扱いますか？",
      intro: "このブログにはすでにObsidianのvaultが接続されています。",
      detail: (revision: number) =>
        `この端末のvaultを同じvaultとして扱うと、続きのrevision（現在 ${revision}）から反映します。別のvaultなら、ここで中止してください。`,
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
      detail: (from: string, to: string) => `公開の起点を「${from}」から「${to}」へ変えます。`,
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
      sourceSwitch: "別のコンテンツソースからObsidianへ切り替えます。既存の記事は作り直されます。",
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
    pushInProgress:
      "前の反映がサーバー側で処理中です。取り消した直後の場合も少しのあいだ残るので、しばらく待ってからもう一度実行してください。",
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
      `大文字小文字だけが違うpathは同時に扱えません。どちらかの名前を変えてください: ${first} / ${second}`,
    normalizationCollision: (first: string, second: string) =>
      `Unicodeの正規化で同じ名前になるファイルが2つあります。どちらかの名前を変えてください: ${first} / ${second}`,
    unsupportedPathCharacters: (path: string) => `pathに使えない文字が含まれています: ${path}`,
    unreadable: (path: string) =>
      `ファイルを読み取れませんでした: ${path}\nクラウド同期が終わっていない可能性があります。すべてのファイルを端末へダウンロードしてから、もう一度実行してください。`,
    vaultChanged:
      "反映の途中でvaultの内容が変わりました。もう一度「Nekote Blogへ反映」を実行してください。",
  },

  normalize: {
    nestedCallout: "入れ子のCalloutは通常の引用として表示しました。",
    unsupportedCalloutType: (identifier: string) =>
      `対応していないCalloutの種類「${identifier}」はnoteとして表示しました。`,
    noteEmbed: "ノートの埋め込みは展開せず、リンクにしました。",
    unresolvedLink: (linkpath: string) => `リンク先を解決できませんでした: ${linkpath}`,
    unresolvedHeading: (heading: string) => `見出しへのリンクを解決できませんでした: ${heading}`,
    unusablePathCharacters: (path: string) =>
      `pathに使えない文字が含まれるため参照を落としました: ${path}`,
    blockReferenceTextOnly: "ブロック参照は表示できないため文字だけを残しました。",
    blockReferenceToTop: "ブロック参照は記事の先頭へのリンクになりました。",
    unpublishedNoteLink: (path: string) =>
      `公開対象外のノートへのリンクは文字だけを残しました: ${path}`,
    svgTextOnly: (path: string) => `SVGは公開できないため文字だけを残しました: ${path}`,
    unsupportedFormatTextOnly: (path: string) =>
      `対応していない形式のファイルは文字だけを残しました: ${path}`,
    ignoredOption: (option: string) => `Nekoteに対応する表現がない指定は無視しました: ${option}`,
    imageSizeIgnored: "画像のサイズ指定は反映されません。",
    outsideVault: (text: string) => `vaultの外を指す参照は取り込めません: ${text}`,
    referencedFileNotFound: (path: string) => `本文が参照するファイルが見つかりません: ${path}`,
    svgDropped: (path: string) => `SVGは公開できないため参照を落としました: ${path}`,
    tooManyAssets: (limit: number) =>
      `本文が参照するアセットが${limit}件を超えています。減らしてください。`,
    assetLimitReached: "参照アセットが上限に達したため、frontmatterの画像を省略しました。",
    frontmatterImageUnusableUrl: (key: string) =>
      `frontmatterの${key}に指定できないURLです。省略しました。`,
    frontmatterImageUnresolved: (key: string, value: string) =>
      `frontmatterの${key}の画像を解決できません。省略しました: ${value}`,
    frontmatterImageNotRaster: (key: string, value: string) =>
      `frontmatterの${key}にはラスタ画像を指定してください。省略しました: ${value}`,
    frontmatterImageNotFound: (key: string, path: string) =>
      `frontmatterの${key}の画像が見つかりません。省略しました: ${path}`,
    frontmatterUnreadable: "frontmatterを読み取れませんでした。",
  },

  frontmatter: {
    missingClosingDelimiter: "frontmatterを閉じる区切り（---）がありません。",
    mustBeString: (key: string) => `frontmatterの${key}は文字列で指定してください。`,
    invalidYaml: "frontmatterのYAMLを解釈できませんでした。",
    mustBeMapping: "frontmatterはキーと値の並びで書いてください。",
    draftMustBeBoolean: "frontmatterのdraftはbooleanで指定してください。",
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
    cancel: "取り消し",
  },

  reportModal: {
    needAttention: (count: number) => `確認が必要な記事 ${count}件`,
    messages: "Nekote Blogからのお知らせ",
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
