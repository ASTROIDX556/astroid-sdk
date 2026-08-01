/**
 * `@astroid/notification` — user notification inbox and delivery preferences.
 *
 * Reads the notification feed, marks items read (individually or in bulk), and
 * reads/updates the per-channel and per-type delivery preferences.
 *
 * @packageDocumentation
 */

import { Resource } from '@astroid/core';
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
  async get(notificationId: string): Promise<Notification> {
    return this.getData<Notification>(`/notifications/${encodeURIComponent(notificationId)}`);
  }

  /** List notifications, filterable by read-state, type, and channel. */
  async list(params: NotificationListParams = {}): Promise<Paginated<Notification>> {
    return this.listData<Notification>('/notifications', { ...params });
  }

  /** Iterate every notification across all pages. */
  iterate(params: NotificationListParams = {}): AsyncGenerator<Notification, void, void> {
    return this.iterateData<Notification>('/notifications', { ...params });
  }

  /** The count of unread notifications. */
  async unreadCount(): Promise<number> {
    const res = await this.client.get<{ count: number }>('/notifications/unread-count');
    return res.data?.count ?? 0;
  }

  /** Mark a single notification read. */
  async markRead(notificationId: string): Promise<Notification> {
    const res = await this.client.post<Notification>(
      `/notifications/${encodeURIComponent(notificationId)}/read`,
    );
    return res.data;
  }

  /** Mark every notification read; returns how many were updated. */
  async markAllRead(): Promise<number> {
    const res = await this.client.post<{ updated: number }>('/notifications/read-all');
    return res.data?.updated ?? 0;
  }

  /** Delete a notification from the inbox. */
  async delete(notificationId: string): Promise<void> {
    await this.client.delete<void>(`/notifications/${encodeURIComponent(notificationId)}`);
  }

  /* ----------------------------- preferences ------------------------------ */

  /** Read the current delivery preferences. */
  async getPreferences(): Promise<NotificationPreferences> {
    return this.getData<NotificationPreferences>('/notifications/preferences');
  }

  /** Update delivery preferences (per channel and per type). */
  async updatePreferences(
    input: UpdateNotificationPreferencesInput,
  ): Promise<NotificationPreferences> {
    const res = await this.client.patch<NotificationPreferences>(
      '/notifications/preferences',
      input,
    );
    return res.data;
  }
}
