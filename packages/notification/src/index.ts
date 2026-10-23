/**
 * `@astroid/notification` — user notification inbox and delivery preferences.
 *
 * Reads the notification feed, marks items read (individually or in bulk), and
 * reads/updates the per-channel and per-type delivery preferences.
 *
 * @packageDocumentation
 */

import { Resource, type RequestOptionsExtras } from '@astroid/core';
import type {
  Notification,
  NotificationListParams,
  NotificationPreferences,
  Paginated,
  UpdateNotificationPreferencesInput,
} from '@astroid/types';

/**
 * The `notifications` namespace on the Astroid client.
 *
 * The inbox is paginated and filterable by read-state, type, and channel.
 * Preferences control which notification types are delivered on which channels
 * (dashboard, email, Discord, Slack, webhook).
 */
export class NotificationResource extends Resource {
  /** Fetch a single notification by id. */
  async get(notificationId: string, options?: RequestOptionsExtras): Promise<Notification> {
    return this.getData<Notification>(
      `/notifications/${encodeURIComponent(notificationId)}`,
      undefined,
      options,
    );
  }

  /** List notifications, filterable by read-state, type, and channel. */
  async list(
    params: NotificationListParams = {},
    options?: RequestOptionsExtras,
  ): Promise<Paginated<Notification>> {
    return this.listData<Notification>('/notifications', { ...params }, options);
  }

  /** Iterate every notification across all pages. */
  iterate(
    params: NotificationListParams = {},
    options?: RequestOptionsExtras,
  ): AsyncGenerator<Notification, void, void> {
    return this.iterateData<Notification>('/notifications', { ...params }, options);
  }

  /** The count of unread notifications. */
  async unreadCount(options?: RequestOptionsExtras): Promise<number> {
    const res = await this.client.get<{ count: number }>('/notifications/unread-count', options);
    return res.data?.count ?? 0;
  }

  /** Mark a single notification read. */
  async markRead(notificationId: string, options?: RequestOptionsExtras): Promise<Notification> {
    const res = await this.client.post<Notification>(
      `/notifications/${encodeURIComponent(notificationId)}/read`,
      undefined,
      options,
    );
    return res.data;
  }

  /** Mark every notification read; returns how many were updated. */
  async markAllRead(options?: RequestOptionsExtras): Promise<number> {
    const res = await this.client.post<{ updated: number }>(
      '/notifications/read-all',
      undefined,
      options,
    );
    return res.data?.updated ?? 0;
  }

  /** Delete a notification from the inbox. */
  async delete(notificationId: string, options?: RequestOptionsExtras): Promise<void> {
    await this.client.delete<void>(`/notifications/${encodeURIComponent(notificationId)}`, options);
  }

  /* ----------------------------- preferences ------------------------------ */

  /** Read the current delivery preferences. */
  async getPreferences(options?: RequestOptionsExtras): Promise<NotificationPreferences> {
    return this.getData<NotificationPreferences>('/notifications/preferences', undefined, options);
  }

  /** Update delivery preferences (per channel and per type). */
  async updatePreferences(
    input: UpdateNotificationPreferencesInput,
    options?: RequestOptionsExtras,
  ): Promise<NotificationPreferences> {
    const res = await this.client.patch<NotificationPreferences>(
      '/notifications/preferences',
      input,
      options,
    );
    return res.data;
  }
}
