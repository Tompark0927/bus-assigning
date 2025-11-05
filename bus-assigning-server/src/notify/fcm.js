// src/notify/fcm.js
// Firebase Cloud Messaging을 통한 푸시 알림

let admin;
try {
  admin = (await import('firebase-admin')).default;
} catch (e) {
  console.warn('firebase-admin not installed, FCM disabled');
}

// Firebase Admin 초기화
let fcmApp = null;
const initializeFirebase = () => {
  if (fcmApp || !admin) return fcmApp;
  
  try {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccount) {
      console.warn('FIREBASE_SERVICE_ACCOUNT_KEY not set, FCM disabled');
      return null;
    }

    const serviceAccountObj = JSON.parse(serviceAccount);
    
    fcmApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccountObj),
      projectId: serviceAccountObj.project_id
    }, 'bus-dispatch-app');
    
    console.log('Firebase Admin initialized successfully');
    return fcmApp;
  } catch (error) {
    console.error('Firebase initialization failed:', error.message);
    return null;
  }
};

/**
 * 긴급 호출 알림 전송
 */
export async function sendCallNotification({ fcmToken, title, body, data = {} }) {
  const app = initializeFirebase();
  if (!app || !admin) {
    console.log('[FCM] Service unavailable, skipping notification');
    return { success: false, reason: 'service_unavailable' };
  }

  try {
    const message = {
      token: fcmToken,
      notification: {
        title,
        body,
      },
      data: {
        ...data,
        type: 'emergency_call',
        timestamp: Date.now().toString()
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'emergency_calls',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
          defaultLightSettings: true
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            category: 'EMERGENCY_CALL'
          }
        }
      }
    };

    const response = await admin.messaging(app).send(message);
    console.log(`[FCM] Notification sent successfully: ${response}`);
    return { success: true, messageId: response };
    
  } catch (error) {
    console.error(`[FCM] Failed to send notification:`, error);
    
    // 토큰 관련 오류인지 체크
    if (error.code === 'messaging/registration-token-not-registered' ||
        error.code === 'messaging/invalid-registration-token') {
      return { success: false, reason: 'invalid_token', shouldRemoveToken: true };
    }
    
    return { success: false, reason: 'send_failed', error: error.message };
  }
}

/**
 * 일반 알림 전송 (배정 확정, 취소 등)
 */
export async function sendGeneralNotification({ fcmToken, title, body, data = {} }) {
  const app = initializeFirebase();
  if (!app || !admin) {
    console.log('[FCM] Service unavailable, skipping notification');
    return { success: false, reason: 'service_unavailable' };
  }

  try {
    const message = {
      token: fcmToken,
      notification: {
        title,
        body,
      },
      data: {
        ...data,
        timestamp: Date.now().toString()
      },
      android: {
        priority: 'normal',
        notification: {
          sound: 'default',
          channelId: 'general',
          priority: 'normal'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1
          }
        }
      }
    };

    const response = await admin.messaging(app).send(message);
    console.log(`[FCM] General notification sent: ${response}`);
    return { success: true, messageId: response };
    
  } catch (error) {
    console.error(`[FCM] Failed to send general notification:`, error);
    
    if (error.code === 'messaging/registration-token-not-registered' ||
        error.code === 'messaging/invalid-registration-token') {
      return { success: false, reason: 'invalid_token', shouldRemoveToken: true };
    }
    
    return { success: false, reason: 'send_failed', error: error.message };
  }
}

/**
 * 여러 기사에게 동시 알림 전송 (멀티캐스트)
 */
export async function sendMulticastNotification({ tokens, title, body, data = {} }) {
  const app = initializeFirebase();
  if (!app || !admin || !tokens.length) {
    return { success: false, reason: 'service_unavailable_or_no_tokens' };
  }

  try {
    const message = {
      notification: {
        title,
        body,
      },
      data: {
        ...data,
        timestamp: Date.now().toString()
      },
      tokens: tokens
    };

    const response = await admin.messaging(app).sendMulticast(message);
    console.log(`[FCM] Multicast sent: ${response.successCount}/${tokens.length} successful`);
    
    // 실패한 토큰들 처리
    const failedTokens = [];
    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const error = resp.error;
          if (error.code === 'messaging/registration-token-not-registered' ||
              error.code === 'messaging/invalid-registration-token') {
            failedTokens.push(tokens[idx]);
          }
        }
      });
    }
    
    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      failedTokens
    };
    
  } catch (error) {
    console.error('[FCM] Multicast failed:', error);
    return { success: false, reason: 'multicast_failed', error: error.message };
  }
}

/**
 * 무효한 토큰 정리 (DB에서 제거)
 */
export async function cleanupInvalidTokens(fastify, invalidTokens) {
  if (!invalidTokens.length) return;
  
  try {
    const client = await fastify.pg.pool.connect();
    await client.query(`
      UPDATE drivers 
      SET fcm_token = NULL 
      WHERE fcm_token = ANY($1)
    `, [invalidTokens]);
    client.release();
    
    console.log(`[FCM] Cleaned up ${invalidTokens.length} invalid tokens`);
  } catch (error) {
    console.error('[FCM] Failed to cleanup invalid tokens:', error);
  }
}

/**
 * 알림 채널 설정 (앱에서 사용할 정보)
 */
export const NOTIFICATION_CHANNELS = {
  EMERGENCY_CALLS: {
    id: 'emergency_calls',
    name: '긴급 호출',
    description: '긴급 배차 호출 알림',
    importance: 'high',
    sound: true,
    vibration: true,
    lightColor: '#ff0000'
  },
  GENERAL: {
    id: 'general',
    name: '일반 알림',
    description: '배정 확정, 취소 등 일반 알림',
    importance: 'normal',
    sound: true,
    vibration: false
  }
};

/**
 * 헬스체크: FCM 서비스 상태 확인
 */
export async function getFCMStatus() {
  return {
    available: !!fcmApp && !!admin,
    initialized: !!fcmApp,
    hasServiceAccount: !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  };
}