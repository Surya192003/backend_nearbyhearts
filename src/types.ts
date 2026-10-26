export type ApiPartner = {
  id: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  city: string
  state: string | null
  country: string | null
  timezone: string
  latitude: number | null
  longitude: number | null
  lastSeenAt: string
}

export type ApiUser = {
  id: string
  email: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  city: string
  state: string | null
  country: string | null
  timezone: string
  latitude: number | null
  longitude: number | null
  lastSeenAt: string
  couple: ApiCouple | null
  partner: ApiPartner | null
}

export type ApiCouple = {
  id: string
  togetherSince: string | null
}

export type ApiVisit = {
  id: string
  createdBy: string
  title: string
  scheduledAt: string
  status: 'scheduled' | 'cancel_pending' | 'cancelled' | 'completed'
  cancelRequestedBy: string | null
  cancelReason: string | null
  createdAt: string
  updatedAt: string
}

export type ApiPairRequest = {
  id: string
  fromUser: {
    id: string
    firstName: string
    lastName: string
    avatarUrl: string | null
  }
  message: string | null
  createdAt: string
}

export type ApiFeedItem = {
  id: string
  authorId: string
  authorName: string
  authorAvatarUrl: string | null
  kind: 'note' | 'photo' | 'milestone' | 'mood'
  text: string
  imageUrl: string | null
  mood: string | null
  createdAt: string
  reactionCount: number
  reactedByMe: boolean
}

export type ApiMessage = {
  id: string
  conversationId: string
  senderId: string
  text: string
  createdAt: string
  status: 'sending' | 'sent' | 'read'
  isIncognito: boolean
  expiresAt: string
}
export type ApiGift = {
  id: string
  name: string
  emoji: string
  priceCents: number
  blurb: string
}

export type ApiSentGift = {
  id: string
  giftId: string
  fromUserId: string
  toUserId: string
  note: string
  createdAt: string
}

export type ApiDonationReceipt = {
  id: string
  amountCents: number
  donorName: string
  message: string
  createdAt: string
}