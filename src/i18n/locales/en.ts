// 英語の文言。**この表が正本**で、`ja.ts`は`satisfies LocaleStrings`で形を合わせる。
//
// 一文が一エントリ。断片を連結して文を作らない（言語によって語順が変わる）。
// 差し込みのある文は関数にして、呼び出し側が整形済みの値を渡す。

/** 件数に合わせた単数形・複数形 */
function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

export const en = {
  /** コマンドパレットのコマンド名とメニュー項目 */
  commands: {
    openDashboard: "Open dashboard",
    openSettings: "Open settings",
    publish: "Publish",
    publishNote: "Publish this note",
    insertFrontmatter: "Insert frontmatter",
    pickThumbnail: "Select thumbnail image",
    pickCover: "Select cover image",
    publishToNekoteBlog: "Publish to Nekote Blog",
    fileMenuPublishNote: "Nekote Blog: Publish this note",
    fileMenuPickThumbnail: "Nekote Blog: Select thumbnail image",
    fileMenuPickCover: "Nekote Blog: Select cover image",
  },

  /** 反映の入口メニュー（リボン・ノートヘッダー・ファイル右クリック）で、反映できない理由として出すラベル */
  publishMenu: {
    notConnected: "Not connected to a blog",
    contentRootNotSelected: "Content root not selected",
    /** ファイル右クリックは他のプラグインと共有のメニューなので、どのプラグインの表示かを接頭語で示す */
    fileMenuNotConnected: "Nekote Blog: Not connected to a blog",
  },

  /** `main.ts`が出す通知 */
  notices: {
    alreadyPublishing: "Nekote Blog: Already publishing.",
    connectFirst: "Nekote Blog: Connect to your blog from the settings first.",
    frontmatterInserted: "Nekote Blog: Frontmatter inserted.",
    frontmatterAlreadyPresent: "Nekote Blog: Frontmatter is already there.",
    frontmatterInsertFailed: "Nekote Blog: Could not insert frontmatter.",
    openSettingsManually:
      "Nekote Blog: Open settings > Community plugins > Nekote Blog to change the settings.",
  },

  settings: {
    authorization: {
      heading: "Waiting for approval",
      starting: "Starting the connection…",
      checkCode:
        "Check that the page opened in your browser shows the code below, then approve it.",
      approvalPage: "Approval page",
      openAgain: "Open again",
      cancel: "Cancel",
    },
    connection: {
      heading: "Connection",
      intro:
        "You need a Nekote Blog account and a blog. Connecting opens an approval page in your browser.",
      deviceName: "Device name",
      deviceNameDesc: "Shown on the approval page and in the device list on your dashboard.",
      connect: "Connect to Nekote Blog",
      connectDesc: "This connects only this device. Each device needs its own connection.",
      connectButton: "Connect",
      connectedBlog: "Connected blog",
      connectedBlogUnknown: "Connection details are not available.",
      blog: (title: string, subdomain: string) => `${title} (${subdomain}.nekote.blog)`,
      thisDevice: "This device",
      thisDeviceUnknown: "Unknown",
      status: "Status",
      refreshButton: "Refresh",
      disconnect: "Disconnect",
      disconnectDesc:
        "Removes this device's access to your blog. Published posts stay online. To publish again, connect once more.",
      disconnectButton: "Disconnect",
    },
    /** 接続状態の説明文（`describeConnection()`） */
    status: {
      notChecked: "Not checked yet",
      noSource: "No content source set (your first publish will connect it)",
      otherSource: (type: string) =>
        `Another source (${type}) is connected. Your first publish will switch it over.`,
      obsidianSource: (revision: number, contentRoot: string) =>
        `Obsidian source connected / revision ${revision} / content root ${contentRoot}`,
    },
    content: {
      heading: "Content",
      contentRoot: "Content root",
      contentRootDesc:
        "The folder publishing starts from. Directly inside it, posts/ holds posts and pages/ holds pages. You cannot publish until you choose one.",
      contentRootNotSelected: "(not selected)",
      imageImportFolder: "Image import folder",
      imageImportFolderDesc:
        'The folder where "Import an image file…" saves images for thumbnails and cover images.',
      imageImportFolderDefault: "assets under the content root (default)",
      folderNotFound: (path: string) => `${path} (not found)`,
      autoInsertFrontmatter: "Insert frontmatter into new notes automatically",
      autoInsertFrontmatterDesc:
        "Adds publishing frontmatter such as draft: true to empty notes created in posts or pages, and to notes moved into them. Only missing keys are added.",
    },
    publishing: {
      heading: "Publishing",
      lastPublish: "Last publish",
      lastPublishNever: "Not published yet.",
      lastPublishAt: (dateTime: string, revision: number) => `${dateTime} (revision ${revision})`,
      publish: "Publish to Nekote Blog",
      publishDesc:
        "Sends the notes under posts/ and pages/ in the content root, plus the files they reference. You can review them before sending.",
      publishButton: "Publish",
    },
    advanced: {
      heading: "Advanced",
      server: "Server",
      serverLocked: "Cannot be changed while connected. Disconnect first to change it.",
      production: "Production",
      staging: "Staging",
    },
    notices: {
      connected: (blogTitle: string) => `Nekote Blog: Connected to ${blogTitle}.`,
      denied: "Nekote Blog: The approval was denied.",
      expired: "Nekote Blog: The approval expired. Please try again.",
      connectionRefreshed: "Nekote Blog: Connection status updated.",
      disconnected: "Nekote Blog: Disconnected.",
      disconnectedButNotRevoked: (reason: string) =>
        `Nekote Blog: This device was disconnected here, but removing it on the server failed (${reason}). Remove it from the device list on your dashboard.`,
      unknownReason: "unknown reason",
      unexpectedError: "Something went wrong. Please wait a moment and try again.",
    },
  },

  publish: {
    selectContentRootFirst: "Select a content root in the plugin settings first.",
    checkingConnection: "Checking connection…",
    checkingPreviousPublish: "Checking the status of the previous publish…",
    readingNotes: "Reading notes…",
    readingAssets: "Reading referenced assets…",
    cancelled: "Publish cancelled.",
    vaultRoot: "(vault root)",
    /** 文中に差し込むコンテンツルートのpath。vaultルートは`vaultRoot`をそのまま使う */
    quotedPath: (path: string) => `"${path}"`,
    blog: (title: string, subdomain: string) =>
      `Publishing to: ${title} (${subdomain}.nekote.blog)`,
    scanConfirm: {
      noteTitle: "There are a lot of notes",
      assetTitle: "There are a lot of referenced assets",
      noteAmount: (contentRoot: string, count: number, size: string) =>
        `The content root ${contentRoot} contains ${count} ${plural(count, "note", "notes")} (${size}).`,
      assetAmount: (contentRoot: string, count: number, size: string) =>
        `The content root ${contentRoot} contains ${count} referenced ${plural(count, "asset", "assets")} (${size}).`,
      noteWarning:
        "Continuing will read all of these notes. Make sure the content root is correct.",
      assetWarning: "Continuing will read all of these assets.",
      confirmLabel: "Continue",
    },
    confirmPublish: {
      title: "Publish to Nekote Blog",
      summary: (
        noteCount: number,
        publishedCount: number,
        draftCount: number,
        assetCount: number,
        contentRoot: string,
      ) =>
        `Publishing ${noteCount} ${plural(noteCount, "note", "notes")} (${publishedCount} public, ${draftCount} ${plural(draftCount, "draft", "drafts")}) and ${assetCount} referenced ${plural(assetCount, "asset", "assets")} from the content root ${contentRoot}.`,
      note: "Unchanged files are not sent. Notes removed since the previous publish are also deleted from the blog.",
      confirmLabel: "Publish",
    },
    /** 「このノートだけ反映」（部分反映）の文言 */
    partial: {
      needsFullPublish:
        "Nekote Blog: Publish the whole vault once before you publish a single note.",
      contentRootChanged:
        "Nekote Blog: The content root has changed. Run Publish to publish everything first.",
      notAllowed:
        "Nekote Blog: You cannot publish a single note right now. Run Publish to publish everything.",
      confirm: {
        title: "Publish this note",
        summary: (title: string, path: string, assetCount: number) =>
          `Publishing only "${title}" (${path}) and ${assetCount} referenced ${plural(assetCount, "asset", "assets")}.`,
        draftNote: "This note is a draft, so it stays unpublished on your blog.",
        note: "Other posts are left as they are. Moves, renames and deletions are not applied by this action. Run Publish for those.",
        confirmLabel: "Publish this note",
      },
      anotherDevice: {
        detail:
          "Another device has published. This note is applied on top of that, and other posts are not changed. To bring this device up to date, sync your vault and run Publish.",
        confirmLabel: "Publish this note",
      },
      preflightCounts: (added: number, updated: number, unchanged: number, untouched: number) =>
        `Posts: ${added} added / ${updated} updated / ${unchanged} unchanged / ${untouched} untouched`,
      reportApplied: (revision: number) => `This note was published (revision ${revision})`,
      untouched: (count: number) =>
        `The other ${count} ${plural(count, "post is", "posts are")} unchanged.`,
    },
    sameVault: {
      title: "Treat this as the connected vault?",
      intro: "An Obsidian vault is already connected to this blog.",
      detail: (revision: number) =>
        `If you treat the vault on this device as the same vault, publishing continues from the existing revision (currently ${revision}). If this is a different vault, cancel here.`,
      serverContentRoot: "Content root on the server",
      confirmLabel: "Continue as the same vault",
    },
    differentVault: {
      title: "This is not the connected vault",
      intro:
        "A different vault is connected to this blog. Publishing from the vault on this device deletes all existing posts first, then rebuilds them from the contents of this vault.",
      warning: "If the rebuild fails partway through, your blog is temporarily left with no posts.",
      confirmLabel: "Replace with this vault",
    },
    contentRootChange: {
      title: "Change the content root",
      detail: (from: string, to: string) =>
        `The starting point for publishing changes from ${from} to ${to}.`,
      warning: "Notes outside the new starting point are deleted from the published posts.",
      confirmLabel: "Change and continue",
    },
    overwrite: {
      publishedFromAnotherDevice: "Published from another device",
      anotherPublishApplied: "Another publish was applied first",
      revisionMismatch: (revision: number) =>
        `The current revision on Nekote Blog is ${revision}, which does not match the record on this device.`,
      warning:
        "Continuing replaces the published posts with the current contents of this vault. To keep the changes made on the other device, sync your vault first and try again.",
      added: (count: number) => `Added ${count} ${plural(count, "file", "files")}`,
      updated: (count: number) => `Updated ${count} ${plural(count, "file", "files")}`,
      deleted: (count: number) => `Deleted ${count} ${plural(count, "file", "files")}`,
      confirmLabel: "Overwrite with this vault",
    },
    /** サーバーが返す`confirmationReasons`の説明文 */
    reasons: {
      initialConnect: "This is the first publish to this blog.",
      sourceSwitch:
        "Switching from another content source to Obsidian. The existing posts are rebuilt.",
      contentRootChanged: "The content root will change.",
      largeDelete: "A large number of posts will be deleted.",
      largeChange: "A large number of posts will be added or updated.",
      largeUpload: "A large amount of file data will be sent.",
      unknown: "This publish needs your confirmation.",
    },
    preflight: {
      initialTitle: "Confirm your first publish",
      title: "Review what will be published",
      articles: (publishedCount: number, draftCount: number) =>
        `${publishedCount} public / ${draftCount} ${plural(draftCount, "draft", "drafts")}`,
      draftPrefix: "[Draft] ",
      article: (title: string, path: string) => `${title} (${path})`,
      counts: (added: number, updated: number, deleted: number, unchanged: number) =>
        `Posts: ${added} added / ${updated} updated / ${deleted} deleted / ${unchanged} unchanged`,
      filesToSend: (count: number, size: string) => `Files to send: ${count} (${size})`,
      confirmLabel: "Publish",
    },
    report: {
      applied: (revision: number) => `Published (revision ${revision})`,
      failed: "Could not publish",
      failedDetail: "The published posts are left as they were. Fix the problem and run it again.",
      applying: "Publishing on Nekote Blog",
      applyingDetail:
        'Sending finished. Run "Publish to Nekote Blog" again to check whether it completed.',
      stopped: "Publish stopped",
      stoppedDetail: "The published posts are unchanged.",
    },
    modeMismatch:
      "The server could not confirm the publish mode, so nothing was sent. Update the plugin, or run Publish to publish everything.",
    pushInProgress:
      "The previous publish is still being processed on the server. Even right after you cancel, it stays in progress for a short while. Wait a moment and run it again.",
    unexpectedError: "Nekote Blog: Something went wrong.",
  },

  /** Push中の進捗 */
  push: {
    begin: "Checking what to publish…",
    upload: "Sending files…",
    finalize: "Verifying files…",
    apply: "Publishing on Nekote Blog…",
  },

  /** 走査を止めた理由 */
  scan: {
    tooManyMarkdown: (count: number, limit: number) =>
      `There are ${count} Markdown files to publish, which is over the limit of ${limit}.`,
    markdownTooLarge: (limit: string, path: string) =>
      `This Markdown file is over the ${limit} limit: ${path}`,
    tooManyAssets: (count: number, limit: number) =>
      `There are ${count} referenced assets, which is over the limit of ${limit}.`,
    assetTooLarge: (limit: string, path: string) =>
      `This asset is over the ${limit} limit: ${path}`,
    caseCollision: (first: string, second: string) =>
      `Paths that differ only in letter case cannot be published together. Rename one of them: ${first} / ${second}`,
    normalizationCollision: (first: string, second: string) =>
      `Two files end up with the same name after Unicode normalization. Rename one of them: ${first} / ${second}`,
    unsupportedPathCharacters: (path: string) =>
      `The path contains unsupported characters: ${path}`,
    notPublishTarget: (path: string) =>
      `This note is not one of the notes that get published: ${path}`,
    unreadable: (path: string) =>
      `Could not read this file. Cloud sync may not have finished. Download all files to this device, then try again. File: ${path}`,
    vaultChanged: 'The vault changed while publishing. Run "Publish to Nekote Blog" again.',
  },

  /** 記事ごとの指摘（`ArticleIssue.message`） */
  normalize: {
    nestedCallout: "Nested callouts were rendered as regular blockquotes.",
    unsupportedCalloutType: (identifier: string) =>
      `This callout type is not supported, so it was rendered as a "note" callout: ${identifier}`,
    noteEmbed: "A note embed was not expanded and became a link instead.",
    unresolvedLink: (linkpath: string) => `Could not resolve the link target: ${linkpath}`,
    unresolvedHeading: (heading: string) => `Could not resolve the link to the heading: ${heading}`,
    unusablePathCharacters: (path: string) =>
      `The path contains characters that cannot be used, so the reference was dropped: ${path}`,
    blockReferenceTextOnly: "A block reference cannot be displayed, so only its text was kept.",
    blockReferenceToTop: "A block reference became a link to the top of the post.",
    unpublishedNoteLink: (path: string) =>
      `A link to a note outside posts/ and pages/ was replaced with its text only: ${path}`,
    svgTextOnly: (path: string) => `SVG cannot be published, so only its text was kept: ${path}`,
    unsupportedFormatTextOnly: (path: string) =>
      `This file format is not supported, so only its text was kept: ${path}`,
    ignoredOption: (option: string) =>
      `The part after "#" in this link has no equivalent on Nekote Blog, so it was ignored: ${option}`,
    imageSizeIgnored: "Image size options are not applied.",
    outsideVault: (text: string) =>
      `A reference that points outside the vault cannot be imported: ${text}`,
    referencedFileNotFound: (path: string) =>
      `A file referenced by this note was not found: ${path}`,
    svgDropped: (path: string) => `SVG cannot be published, so the reference was dropped: ${path}`,
    tooManyAssets: (limit: number) =>
      `This note references more than ${limit} assets. Reduce the number of referenced assets.`,
    assetLimitReached:
      "The referenced asset limit was reached, so the frontmatter image was skipped.",
    frontmatterImageUnusableUrl: (key: string) =>
      `The frontmatter ${key} must be a relative path or an https URL, so it was skipped.`,
    frontmatterImageUnresolved: (key: string, value: string) =>
      `Could not resolve the frontmatter ${key} image, so it was skipped: ${value}`,
    frontmatterImageNotRaster: (key: string, value: string) =>
      `The frontmatter ${key} must be a PNG, JPG, JPEG, GIF, WebP or AVIF image, so it was skipped: ${value}`,
    frontmatterImageNotFound: (key: string, path: string) =>
      `The frontmatter ${key} image was not found, so it was skipped: ${path}`,
    frontmatterUnreadable: "Could not read the frontmatter.",
  },

  frontmatter: {
    missingClosingDelimiter: "The frontmatter is missing its closing --- delimiter.",
    mustBeString: (key: string) => `The frontmatter ${key} must be a string.`,
    invalidYaml: "Could not parse the frontmatter YAML.",
    mustBeMapping: "The frontmatter must be a list of key-value pairs.",
    draftMustBeBoolean: "The frontmatter draft must be true or false.",
  },

  /** プラグインが自分で作る通信エラー文（サーバーが返す`message`はそのまま出す） */
  api: {
    unreadableResponse: "Could not read the response from the server.",
    emptyResponse: "The server returned an empty response.",
    unsupportedVersion: "This version of the plugin is not supported. Update the plugin.",
    unauthorized:
      "The connection is no longer valid. Reconnect from the plugin settings in Obsidian.",
    unreachable: "Could not reach Nekote Blog. Check your network connection.",
    httpError: (status: number) => `The server returned an error (HTTP ${status}).`,
  },

  connection: {
    unreachable: "Could not reach the server.",
  },

  vault: {
    unreadableFile: (path: string) => `Could not read this file: ${path}`,
  },

  confirmModal: {
    cancel: "Cancel",
  },

  reportModal: {
    needAttention: (count: number) =>
      `${count} ${plural(count, "post needs", "posts need")} attention`,
    messages: "Errors and warnings from the server",
    error: "Error",
    warning: "Warning",
    article: (title: string, path: string) => `${title} (${path})`,
  },

  imageModal: {
    importItem: "Import an image file…",
    unsupportedFormat: "Nekote Blog: Supported formats are PNG, JPG, JPEG, GIF, WebP and AVIF.",
    importFailed: "Nekote Blog: Could not import the image.",
    thumbnail: {
      placeholder: "Select an image for the thumbnail…",
      applied: "Nekote Blog: Thumbnail set.",
      failed: "Nekote Blog: Could not set the thumbnail.",
    },
    cover: {
      placeholder: "Select an image for the cover image…",
      applied: "Nekote Blog: Cover image set.",
      failed: "Nekote Blog: Could not set the cover image.",
    },
  },

  list: {
    andMore: (count: number) => `and ${count} more`,
  },
};

export type LocaleStrings = typeof en;
