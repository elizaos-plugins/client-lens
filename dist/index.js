// src/lens-agent-client.ts
import { elizaLogger as elizaLogger5 } from "@elizaos/core";
import { privateKeyToAccount } from "viem/accounts";

// src/client.ts
import { elizaLogger } from "@elizaos/core";
import {
  LensClient as LensClientCore,
  production,
  LensTransactionStatusType,
  LimitType,
  NotificationType,
  PublicationType,
  FeedEventItemType
} from "@lens-protocol/client";

// src/utils.ts
import { stringToUuid } from "@elizaos/core";
function publicationId({
  pubId,
  agentId
}) {
  return `${pubId}-${agentId}`;
}
function publicationUuid(props) {
  return stringToUuid(publicationId(props));
}
var handleBroadcastResult = (broadcastResult) => {
  const broadcastValue = broadcastResult.unwrap();
  if ("id" in broadcastValue || "txId" in broadcastValue) {
    return broadcastValue;
  } else {
    throw new Error();
  }
};
var getProfilePictureUri = (picture) => {
  var _a, _b;
  if ("optimized" in picture) {
    return ((_a = picture.optimized) == null ? void 0 : _a.uri) || ((_b = picture.raw) == null ? void 0 : _b.uri) || picture.uri;
  } else {
    return picture.uri;
  }
};
function omit(obj, key) {
  const result = {};
  Object.keys(obj).forEach((currentKey) => {
    if (currentKey !== key) {
      result[currentKey] = obj[currentKey];
    }
  });
  return result;
}

// src/client.ts
var LensClient = class {
  runtime;
  account;
  cache;
  lastInteractionTimestamp;
  profileId;
  authenticated;
  authenticatedProfile;
  core;
  constructor(opts) {
    this.cache = opts.cache;
    this.runtime = opts.runtime;
    this.account = opts.account;
    this.core = new LensClientCore({
      environment: production
    });
    this.lastInteractionTimestamp = /* @__PURE__ */ new Date();
    this.profileId = opts.profileId;
    this.authenticated = false;
    this.authenticatedProfile = null;
  }
  async authenticate() {
    try {
      const { id, text } = await this.core.authentication.generateChallenge({
        signedBy: this.account.address,
        for: this.profileId
      });
      const signature = await this.account.signMessage({
        message: text
      });
      await this.core.authentication.authenticate({ id, signature });
      this.authenticatedProfile = await this.core.profile.fetch({
        forProfileId: this.profileId
      });
      this.authenticated = true;
    } catch (error) {
      elizaLogger.error("client-lens::client error: ", error);
      throw error;
    }
  }
  async createPublication(contentURI, onchain = false, commentOn) {
    try {
      if (!this.authenticated) {
        await this.authenticate();
        elizaLogger.log("done authenticating");
      }
      let broadcastResult;
      if (commentOn) {
        broadcastResult = onchain ? await this.createCommentOnchain(contentURI, commentOn) : await this.createCommentMomoka(contentURI, commentOn);
      } else {
        broadcastResult = onchain ? await this.createPostOnchain(contentURI) : await this.createPostMomoka(contentURI);
      }
      elizaLogger.log("broadcastResult", broadcastResult);
      if (broadcastResult.id) {
        return await this.core.publication.fetch({
          forId: broadcastResult.id
        });
      }
      const completion = await this.core.transaction.waitUntilComplete({
        forTxHash: broadcastResult.txHash
      });
      if ((completion == null ? void 0 : completion.status) === LensTransactionStatusType.Complete) {
        return await this.core.publication.fetch({
          forTxHash: completion == null ? void 0 : completion.txHash
        });
      }
    } catch (error) {
      elizaLogger.error("client-lens::client error: ", error);
      throw error;
    }
  }
  async getPublication(pubId) {
    if (this.cache.has(`lens/publication/${pubId}`)) {
      return this.cache.get(`lens/publication/${pubId}`);
    }
    const publication = await this.core.publication.fetch({ forId: pubId });
    if (publication)
      this.cache.set(`lens/publication/${pubId}`, publication);
    return publication;
  }
  async getPublicationsFor(profileId, limit = 50) {
    const timeline = [];
    let next = void 0;
    do {
      const { items, next: newNext } = next ? await next() : await this.core.publication.fetchAll({
        limit: LimitType.Fifty,
        where: {
          from: [profileId],
          publicationTypes: [PublicationType.Post]
        }
      });
      items.forEach((publication) => {
        this.cache.set(
          `lens/publication/${publication.id}`,
          publication
        );
        timeline.push(publication);
      });
      next = newNext;
    } while (next && timeline.length < limit);
    return timeline;
  }
  async getMentions() {
    if (!this.authenticated) {
      await this.authenticate();
    }
    const result = await this.core.notifications.fetch({
      where: {
        highSignalFilter: false,
        // true,
        notificationTypes: [
          NotificationType.Mentioned,
          NotificationType.Commented
        ]
      }
    });
    const mentions = [];
    const { items, next } = result.unwrap();
    items.map((notification) => {
      const item = notification.publication || notification.comment;
      if (!item.isEncrypted) {
        mentions.push(item);
        this.cache.set(`lens/publication/${item.id}`, item);
      }
    });
    return { mentions, next };
  }
  async getProfile(profileId) {
    var _a, _b, _c, _d;
    if (this.cache.has(`lens/profile/${profileId}`)) {
      return this.cache.get(`lens/profile/${profileId}`);
    }
    const result = await this.core.profile.fetch({
      forProfileId: profileId
    });
    if (!(result == null ? void 0 : result.id)) {
      elizaLogger.error("Error fetching user by profileId");
      throw "getProfile ERROR";
    }
    const profile = {
      id: "",
      profileId,
      name: "",
      handle: ""
    };
    profile.id = result.id;
    profile.name = (_a = result.metadata) == null ? void 0 : _a.displayName;
    profile.handle = (_b = result.handle) == null ? void 0 : _b.localName;
    profile.bio = (_c = result.metadata) == null ? void 0 : _c.bio;
    profile.pfp = getProfilePictureUri((_d = result.metadata) == null ? void 0 : _d.picture);
    this.cache.set(`lens/profile/${profileId}`, profile);
    return profile;
  }
  async getTimeline(profileId, limit = 10) {
    try {
      if (!this.authenticated) {
        await this.authenticate();
      }
      const timeline = [];
      let next = void 0;
      do {
        const result = next ? await next() : await this.core.feed.fetch({
          where: {
            for: profileId,
            feedEventItemTypes: [FeedEventItemType.Post]
          }
        });
        const data = result.unwrap();
        data.items.forEach((item) => {
          if (timeline.length < limit && !item.root.isEncrypted) {
            this.cache.set(
              `lens/publication/${item.id}`,
              item.root
            );
            timeline.push(item.root);
          }
        });
        next = data.pageInfo.next;
      } while (next && timeline.length < limit);
      return timeline;
    } catch (error) {
      elizaLogger.error(error);
      throw new Error("client-lens:: getTimeline");
    }
  }
  async createPostOnchain(contentURI) {
    var _a;
    if ((_a = this.authenticatedProfile) == null ? void 0 : _a.signless) {
      const broadcastResult2 = await this.core.publication.postOnchain({
        contentURI,
        openActionModules: []
        // TODO: if collectable
      });
      return handleBroadcastResult(broadcastResult2);
    }
    const typedDataResult = await this.core.publication.createOnchainPostTypedData({
      contentURI,
      openActionModules: []
      // TODO: if collectable
    });
    const { id, typedData } = typedDataResult.unwrap();
    const signedTypedData = await this.account.signTypedData({
      domain: omit(typedData.domain, "__typename"),
      types: omit(typedData.types, "__typename"),
      primaryType: "Post",
      message: omit(typedData.value, "__typename")
    });
    const broadcastResult = await this.core.transaction.broadcastOnchain({
      id,
      signature: signedTypedData
    });
    return handleBroadcastResult(broadcastResult);
  }
  async createPostMomoka(contentURI) {
    var _a;
    elizaLogger.log("createPostMomoka");
    if ((_a = this.authenticatedProfile) == null ? void 0 : _a.signless) {
      const broadcastResult2 = await this.core.publication.postOnMomoka({
        contentURI
      });
      return handleBroadcastResult(broadcastResult2);
    }
    const typedDataResult = await this.core.publication.createMomokaPostTypedData({
      contentURI
    });
    elizaLogger.log("typedDataResult", typedDataResult);
    const { id, typedData } = typedDataResult.unwrap();
    const signedTypedData = await this.account.signTypedData({
      domain: omit(typedData.domain, "__typename"),
      types: omit(typedData.types, "__typename"),
      primaryType: "Post",
      message: omit(typedData.value, "__typename")
    });
    const broadcastResult = await this.core.transaction.broadcastOnMomoka({
      id,
      signature: signedTypedData
    });
    return handleBroadcastResult(broadcastResult);
  }
  async createCommentOnchain(contentURI, commentOn) {
    var _a;
    if ((_a = this.authenticatedProfile) == null ? void 0 : _a.signless) {
      const broadcastResult2 = await this.core.publication.commentOnchain({
        commentOn,
        contentURI
      });
      return handleBroadcastResult(broadcastResult2);
    }
    const typedDataResult = await this.core.publication.createOnchainCommentTypedData({
      commentOn,
      contentURI
    });
    const { id, typedData } = typedDataResult.unwrap();
    const signedTypedData = await this.account.signTypedData({
      domain: omit(typedData.domain, "__typename"),
      types: omit(typedData.types, "__typename"),
      primaryType: "Comment",
      message: omit(typedData.value, "__typename")
    });
    const broadcastResult = await this.core.transaction.broadcastOnchain({
      id,
      signature: signedTypedData
    });
    return handleBroadcastResult(broadcastResult);
  }
  async createCommentMomoka(contentURI, commentOn) {
    var _a;
    if ((_a = this.authenticatedProfile) == null ? void 0 : _a.signless) {
      const broadcastResult2 = await this.core.publication.commentOnMomoka(
        {
          commentOn,
          contentURI
        }
      );
      return handleBroadcastResult(broadcastResult2);
    }
    const typedDataResult = await this.core.publication.createMomokaCommentTypedData({
      commentOn,
      contentURI
    });
    const { id, typedData } = typedDataResult.unwrap();
    const signedTypedData = await this.account.signTypedData({
      domain: omit(typedData.domain, "__typename"),
      types: omit(typedData.types, "__typename"),
      primaryType: "Comment",
      message: omit(typedData.value, "__typename")
    });
    const broadcastResult = await this.core.transaction.broadcastOnMomoka({
      id,
      signature: signedTypedData
    });
    return handleBroadcastResult(broadcastResult);
  }
};

// src/post.ts
import {
  composeContext,
  generateText,
  ModelClass,
  stringToUuid as stringToUuid3,
  elizaLogger as elizaLogger3
} from "@elizaos/core";

// src/prompts.ts
import {
  messageCompletionFooter,
  shouldRespondFooter
} from "@elizaos/core";
var formatPublication = (publication) => {
  var _a, _b, _c, _d;
  return `ID: ${publication.id}
    From: ${(_a = publication.by.metadata) == null ? void 0 : _a.displayName} (@${(_b = publication.by.handle) == null ? void 0 : _b.localName})${(_c = publication.by.handle) == null ? void 0 : _c.localName})${publication.commentOn ? `
In reply to: @${(_d = publication.commentOn.by.handle) == null ? void 0 : _d.localName}` : ""}
Text: ${publication.metadata.content}`;
};
var formatTimeline = (character, timeline) => `# ${character.name}'s Home Timeline
${timeline.map(formatPublication).join("\n")}
`;
var headerTemplate = `
{{timeline}}

# Knowledge
{{knowledge}}

About {{agentName}} (@{{lensHandle}}):
{{bio}}
{{lore}}
{{postDirections}}

{{providers}}

{{recentPosts}}

{{characterPostExamples}}`;
var postTemplate = headerTemplate + `
# Task: Generate a post in the voice and style of {{agentName}}, aka @{{lensHandle}}
Write a single sentence post that is {{adjective}} about {{topic}} (without mentioning {{topic}} directly), from the perspective of {{agentName}}.
Try to write something totally different than previous posts. Do not add commentary or ackwowledge this request, just write the post.

Your response should not contain any questions. Brief, concise statements only. No emojis. Use \\n\\n (double spaces) between statements.`;
var messageHandlerTemplate = headerTemplate + `
Recent interactions between {{agentName}} and other users:
{{recentPostInteractions}}

Thread of publications You Are Replying To:
{{formattedConversation}}

# Task: Generate a post in the voice, style and perspective of {{agentName}} (@{{lensHandle}}):
{{currentPost}}` + messageCompletionFooter;
var shouldRespondTemplate = (
  //
  `# Task: Decide if {{agentName}} should respond.
    About {{agentName}}:
    {{bio}}

    # INSTRUCTIONS: Determine if {{agentName}} (@{{lensHandle}}) should respond to the message and participate in the conversation. Do not comment. Just respond with "RESPOND" or "IGNORE" or "STOP".

Response options are RESPOND, IGNORE and STOP.

{{agentName}} should respond to messages that are directed at them, or participate in conversations that are interesting or relevant to their background, IGNORE messages that are irrelevant to them, and should STOP if the conversation is concluded.

{{agentName}} is in a room with other users and wants to be conversational, but not annoying.
{{agentName}} should RESPOND to messages that are directed at them, or participate in conversations that are interesting or relevant to their background.
If a message is not interesting or relevant, {{agentName}} should IGNORE.
If a message thread has become repetitive, {{agentName}} should IGNORE.
Unless directly RESPONDing to a user, {{agentName}} should IGNORE messages that are very short or do not contain much information.
If a user asks {{agentName}} to stop talking, {{agentName}} should STOP.
If {{agentName}} concludes a conversation and isn't part of the conversation anymore, {{agentName}} should STOP.

IMPORTANT: {{agentName}} (aka @{{lensHandle}}) is particularly sensitive about being annoying, so if there is any doubt, it is better to IGNORE than to RESPOND.

Thread of messages You Are Replying To:
{{formattedConversation}}

Current message:
{{currentPost}}

` + shouldRespondFooter
);

// src/memory.ts
import {
  elizaLogger as elizaLogger2,
  getEmbeddingZeroVector,
  stringToUuid as stringToUuid2
} from "@elizaos/core";
function createPublicationMemory({
  roomId,
  runtime,
  publication
}) {
  const commentOn = publication.commentOn ? publicationUuid({
    pubId: publication.commentOn.id,
    agentId: runtime.agentId
  }) : void 0;
  return {
    id: publicationUuid({
      pubId: publication.id,
      agentId: runtime.agentId
    }),
    agentId: runtime.agentId,
    userId: runtime.agentId,
    content: {
      text: publication.metadata.content,
      source: "lens",
      url: "",
      commentOn,
      id: publication.id
    },
    roomId,
    embedding: getEmbeddingZeroVector()
  };
}
async function buildConversationThread({
  publication,
  runtime,
  client
}) {
  const thread = [];
  const visited = /* @__PURE__ */ new Set();
  async function processThread(currentPublication) {
    var _a, _b;
    if (visited.has(currentPublication.id)) {
      return;
    }
    visited.add(currentPublication.id);
    const roomId = publicationUuid({
      pubId: currentPublication.id,
      agentId: runtime.agentId
    });
    const memory = await runtime.messageManager.getMemoryById(roomId);
    if (!memory) {
      elizaLogger2.log(
        "Creating memory for publication",
        currentPublication.id
      );
      const userId = stringToUuid2(currentPublication.by.id);
      await runtime.ensureConnection(
        userId,
        roomId,
        currentPublication.by.id,
        ((_a = currentPublication.by.metadata) == null ? void 0 : _a.displayName) || ((_b = currentPublication.by.handle) == null ? void 0 : _b.localName),
        "lens"
      );
      await runtime.messageManager.createMemory(
        createPublicationMemory({
          roomId,
          runtime,
          publication: currentPublication
        })
      );
    }
    thread.unshift(currentPublication);
    if (currentPublication.commentOn) {
      const parentPublication = await client.getPublication(
        currentPublication.commentOn.id
      );
      if (parentPublication) await processThread(parentPublication);
    }
  }
  await processThread(publication);
  return thread;
}

// src/actions.ts
import { textOnly } from "@lens-protocol/metadata";
async function sendPublication({
  client,
  runtime,
  content,
  roomId,
  commentOn,
  ipfs
}) {
  const metadata = textOnly({ content: content.text });
  const contentURI = await ipfs.pinJson(metadata);
  const publication = await client.createPublication(
    contentURI,
    false,
    // TODO: support collectable settings
    commentOn
  );
  if (publication) {
    return {
      publication,
      memory: createPublicationMemory({
        roomId,
        runtime,
        publication
      })
    };
  }
  return {};
}

// src/post.ts
var LensPostManager = class {
  constructor(client, runtime, profileId, cache, ipfs) {
    this.client = client;
    this.runtime = runtime;
    this.profileId = profileId;
    this.cache = cache;
    this.ipfs = ipfs;
  }
  timeout;
  async start() {
    const generateNewPubLoop = async () => {
      try {
        await this.generateNewPublication();
      } catch (error) {
        elizaLogger3.error(error);
        return;
      }
      this.timeout = setTimeout(
        generateNewPubLoop,
        (Math.floor(Math.random() * (4 - 1 + 1)) + 1) * 60 * 60 * 1e3
      );
    };
    generateNewPubLoop();
  }
  async stop() {
    if (this.timeout) clearTimeout(this.timeout);
  }
  async generateNewPublication() {
    var _a;
    elizaLogger3.info("Generating new publication");
    try {
      const profile = await this.client.getProfile(this.profileId);
      await this.runtime.ensureUserExists(
        this.runtime.agentId,
        profile.handle,
        this.runtime.character.name,
        "lens"
      );
      const timeline = await this.client.getTimeline(this.profileId);
      const formattedHomeTimeline = formatTimeline(
        this.runtime.character,
        timeline
      );
      const generateRoomId = stringToUuid3("lens_generate_room");
      const state = await this.runtime.composeState(
        {
          roomId: generateRoomId,
          userId: this.runtime.agentId,
          agentId: this.runtime.agentId,
          content: { text: "", action: "" }
        },
        {
          lensHandle: profile.handle,
          timeline: formattedHomeTimeline
        }
      );
      const context = composeContext({
        state,
        template: ((_a = this.runtime.character.templates) == null ? void 0 : _a.lensPostTemplate) || postTemplate
      });
      const content = await generateText({
        runtime: this.runtime,
        context,
        modelClass: ModelClass.SMALL
      });
      if (this.runtime.getSetting("LENS_DRY_RUN") === "true") {
        elizaLogger3.info(`Dry run: would have posted: ${content}`);
        return;
      }
      try {
        const { publication } = await sendPublication({
          client: this.client,
          runtime: this.runtime,
          roomId: generateRoomId,
          content: { text: content },
          ipfs: this.ipfs
        });
        if (!publication) throw new Error("failed to send publication");
        const roomId = publicationUuid({
          agentId: this.runtime.agentId,
          pubId: publication.id
        });
        await this.runtime.ensureRoomExists(roomId);
        await this.runtime.ensureParticipantInRoom(
          this.runtime.agentId,
          roomId
        );
        elizaLogger3.info(`[Lens Client] Published ${publication.id}`);
        await this.runtime.messageManager.createMemory(
          createPublicationMemory({
            roomId,
            runtime: this.runtime,
            publication
          })
        );
      } catch (error) {
        elizaLogger3.error("Error sending publication:", error);
      }
    } catch (error) {
      elizaLogger3.error("Error generating new publication:", error);
    }
  }
};

// src/interactions.ts
import {
  composeContext as composeContext2,
  generateMessageResponse,
  generateShouldRespond,
  ModelClass as ModelClass2,
  stringToUuid as stringToUuid4,
  elizaLogger as elizaLogger4
} from "@elizaos/core";
import { toHex } from "viem";
var LensInteractionManager = class {
  constructor(client, runtime, profileId, cache, ipfs) {
    this.client = client;
    this.runtime = runtime;
    this.profileId = profileId;
    this.cache = cache;
    this.ipfs = ipfs;
  }
  timeout;
  async start() {
    const handleInteractionsLoop = async () => {
      try {
        await this.handleInteractions();
      } catch (error) {
        elizaLogger4.error(error);
        return;
      }
      this.timeout = setTimeout(
        handleInteractionsLoop,
        Number(this.runtime.getSetting("LENS_POLL_INTERVAL") || 120) * 1e3
        // Default to 2 minutes
      );
    };
    handleInteractionsLoop();
  }
  async stop() {
    if (this.timeout) clearTimeout(this.timeout);
  }
  async handleInteractions() {
    var _a, _b;
    elizaLogger4.info("Handle Lens interactions");
    const { mentions } = await this.client.getMentions();
    const agent = await this.client.getProfile(this.profileId);
    for (const mention of mentions) {
      const messageHash = toHex(mention.id);
      const conversationId = `${messageHash}-${this.runtime.agentId}`;
      const roomId = stringToUuid4(conversationId);
      const userId = stringToUuid4(mention.by.id);
      const pastMemoryId = publicationUuid({
        agentId: this.runtime.agentId,
        pubId: mention.id
      });
      const pastMemory = await this.runtime.messageManager.getMemoryById(pastMemoryId);
      if (pastMemory) {
        continue;
      }
      await this.runtime.ensureConnection(
        userId,
        roomId,
        mention.by.id,
        ((_a = mention.by.metadata) == null ? void 0 : _a.displayName) || ((_b = mention.by.handle) == null ? void 0 : _b.localName),
        "lens"
      );
      const thread = await buildConversationThread({
        client: this.client,
        runtime: this.runtime,
        publication: mention
      });
      const memory = {
        // @ts-ignore Metadata
        content: { text: mention.metadata.content, hash: mention.id },
        agentId: this.runtime.agentId,
        userId,
        roomId
      };
      await this.handlePublication({
        agent,
        publication: mention,
        memory,
        thread
      });
    }
    this.client.lastInteractionTimestamp = /* @__PURE__ */ new Date();
  }
  async handlePublication({
    agent,
    publication,
    memory,
    thread
  }) {
    var _a, _b, _c, _d, _e, _f;
    if (publication.by.id === agent.id) {
      elizaLogger4.info("skipping cast from bot itself", publication.id);
      return;
    }
    if (!memory.content.text) {
      elizaLogger4.info("skipping cast with no text", publication.id);
      return { text: "", action: "IGNORE" };
    }
    const currentPost = formatPublication(publication);
    const timeline = await this.client.getTimeline(this.profileId);
    const formattedTimeline = formatTimeline(
      this.runtime.character,
      timeline
    );
    const formattedConversation = thread.map((pub) => {
      var _a2;
      const content = pub.metadata.content;
      return `@${(_a2 = pub.by.handle) == null ? void 0 : _a2.localName} (${new Date(
        pub.createdAt
      ).toLocaleString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        day: "numeric"
      })}):
                ${content}`;
    }).join("\n\n");
    const state = await this.runtime.composeState(memory, {
      lensHandle: agent.handle,
      timeline: formattedTimeline,
      currentPost,
      formattedConversation
    });
    const shouldRespondContext = composeContext2({
      state,
      template: ((_a = this.runtime.character.templates) == null ? void 0 : _a.lensShouldRespondTemplate) || ((_c = (_b = this.runtime.character) == null ? void 0 : _b.templates) == null ? void 0 : _c.shouldRespondTemplate) || shouldRespondTemplate
    });
    const memoryId = publicationUuid({
      agentId: this.runtime.agentId,
      pubId: publication.id
    });
    const castMemory = await this.runtime.messageManager.getMemoryById(memoryId);
    if (!castMemory) {
      await this.runtime.messageManager.createMemory(
        createPublicationMemory({
          roomId: memory.roomId,
          runtime: this.runtime,
          publication
        })
      );
    }
    const shouldRespondResponse = await generateShouldRespond({
      runtime: this.runtime,
      context: shouldRespondContext,
      modelClass: ModelClass2.SMALL
    });
    if (shouldRespondResponse === "IGNORE" || shouldRespondResponse === "STOP") {
      elizaLogger4.info(
        `Not responding to publication because generated ShouldRespond was ${shouldRespondResponse}`
      );
      return;
    }
    const context = composeContext2({
      state,
      template: ((_d = this.runtime.character.templates) == null ? void 0 : _d.lensMessageHandlerTemplate) ?? ((_f = (_e = this.runtime.character) == null ? void 0 : _e.templates) == null ? void 0 : _f.messageHandlerTemplate) ?? messageHandlerTemplate
    });
    const responseContent = await generateMessageResponse({
      runtime: this.runtime,
      context,
      modelClass: ModelClass2.LARGE
    });
    responseContent.inReplyTo = memoryId;
    if (!responseContent.text) return;
    if (this.runtime.getSetting("LENS_DRY_RUN") === "true") {
      elizaLogger4.info(
        `Dry run: would have responded to publication ${publication.id} with ${responseContent.text}`
      );
      return;
    }
    const callback = async (content, files) => {
      var _a2;
      try {
        if (memoryId && !content.inReplyTo) {
          content.inReplyTo = memoryId;
        }
        const result = await sendPublication({
          runtime: this.runtime,
          client: this.client,
          content,
          roomId: memory.roomId,
          commentOn: publication.id,
          ipfs: this.ipfs
        });
        if (!((_a2 = result.publication) == null ? void 0 : _a2.id))
          throw new Error("publication not sent");
        result.memory.content.action = content.action;
        await this.runtime.messageManager.createMemory(result.memory);
        return [result.memory];
      } catch (error) {
        console.error("Error sending response cast:", error);
        return [];
      }
    };
    const responseMessages = await callback(responseContent);
    const newState = await this.runtime.updateRecentMessageState(state);
    await this.runtime.processActions(
      memory,
      responseMessages,
      newState,
      callback
    );
  }
};

// src/providers/StorjProvider.ts
import axios from "axios";
import FormData from "form-data";
var StorjProvider = class {
  STORJ_API_URL = "https://www.storj-ipfs.com";
  STORJ_API_USERNAME;
  STORJ_API_PASSWORD;
  baseURL;
  client;
  constructor(runtime) {
    this.STORJ_API_USERNAME = runtime.getSetting("STORJ_API_USERNAME");
    this.STORJ_API_PASSWORD = runtime.getSetting("STORJ_API_PASSWORD");
    this.baseURL = `${this.STORJ_API_URL}/api/v0`;
    this.client = this.createClient();
  }
  createClient() {
    return axios.create({
      baseURL: this.baseURL,
      auth: {
        username: this.STORJ_API_USERNAME,
        password: this.STORJ_API_PASSWORD
      }
    });
  }
  hash(uriOrHash) {
    return typeof uriOrHash === "string" && uriOrHash.startsWith("ipfs://") ? uriOrHash.split("ipfs://")[1] : uriOrHash;
  }
  gatewayURL(uriOrHash) {
    return `${this.STORJ_API_URL}/ipfs/${this.hash(uriOrHash)}`;
  }
  async pinJson(json) {
    if (typeof json !== "string") {
      json = JSON.stringify(json);
    }
    const formData = new FormData();
    formData.append("path", Buffer.from(json, "utf-8").toString());
    const headers = {
      "Content-Type": "multipart/form-data",
      ...formData.getHeaders()
    };
    const { data } = await this.client.post(
      "add?cid-version=1",
      formData.getBuffer(),
      { headers }
    );
    return this.gatewayURL(data.Hash);
  }
  async pinFile(file) {
    const formData = new FormData();
    formData.append("file", file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype
    });
    const response = await this.client.post("add?cid-version=1", formData, {
      headers: {
        "Content-Type": `multipart/form-data; boundary=${formData.getBoundary()}`
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    return this.gatewayURL(response.data.Hash);
  }
};
var StorjProvider_default = StorjProvider;

// src/lens-agent-client.ts
var LensAgentClient = class {
  constructor(runtime) {
    this.runtime = runtime;
    const cache = /* @__PURE__ */ new Map();
    const privateKey = runtime.getSetting(
      "EVM_PRIVATE_KEY"
    );
    if (!privateKey) {
      throw new Error("EVM_PRIVATE_KEY is missing");
    }
    const account = privateKeyToAccount(privateKey);
    this.profileId = runtime.getSetting(
      "LENS_PROFILE_ID"
    );
    this.client = new LensClient({
      runtime: this.runtime,
      account,
      cache,
      profileId: this.profileId
    });
    elizaLogger5.info("Lens client initialized.");
    this.ipfs = new StorjProvider_default(runtime);
    this.posts = new LensPostManager(
      this.client,
      this.runtime,
      this.profileId,
      cache,
      this.ipfs
    );
    this.interactions = new LensInteractionManager(
      this.client,
      this.runtime,
      this.profileId,
      cache,
      this.ipfs
    );
  }
  client;
  posts;
  interactions;
  profileId;
  ipfs;
  async start() {
    await Promise.all([this.posts.start(), this.interactions.start()]);
  }
  async stop() {
    await Promise.all([this.posts.stop(), this.interactions.stop()]);
  }
};

// src/index.ts
var LensClientInterface = {
  name: "lens",
  config: {},
  start: async (runtime) => new LensAgentClient(runtime),
  stop: async (runtime) => {
    try {
      console.log("Stopping lens client", runtime.agentId);
      await runtime.clients.lens.stop();
    } catch (e) {
      console.error("client-lens interface stop error", e);
    }
  }
};
var index_default = LensClientInterface;
export {
  index_default as default
};
//# sourceMappingURL=index.js.map