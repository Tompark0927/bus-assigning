import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
  Alert,
  Switch,
  Dimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getProfile, logout } from "../api/auth";
import { API_URL } from "../api/auth";

const { width } = Dimensions.get('window');

export default function HomeScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myShifts, setMyShifts] = useState([]);
  const [availableCalls, setAvailableCalls] = useState([]);
  const [todayState, setTodayState] = useState('WORKING'); // WORKING, OFF, BLOCKED
  const [isOnline, setIsOnline] = useState(true);
  
  const pingIntervalRef = useRef(null);

  useEffect(() => {
    loadUserProfile();
    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (user && isOnline) {
      startPresencePing();
    } else {
      stopPresencePing();
    }
  }, [user, isOnline]);

  const loadUserProfile = async () => {
    try {
      const res = await getProfile();
      setUser(res.data.user);
      await loadDashboardData();
    } catch (err) {
      console.error('Profile load error:', err);
      navigation.replace("Login");
    } finally {
      setLoading(false);
    }
  };

  const loadDashboardData = async () => {
    try {
      const token = await AsyncStorage.getItem("token");
      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      };

      // 내 시프트 조회
      const shiftsRes = await fetch(`${API_URL}/driver/my-shifts`, { headers });
      const myShiftsData = shiftsRes.ok ? await shiftsRes.json() : [];

      // 사용 가능한 긴급 호출 조회
      const callsRes = await fetch(`${API_URL}/driver/available-calls`, { headers });
      const callsData = callsRes.ok ? await callsRes.json() : [];

      // 내 오늘 상태 조회
      const stateRes = await fetch(`${API_URL}/driver/today-state`, { headers });
      const stateData = stateRes.ok ? await stateRes.json() : {};

      setMyShifts(myShiftsData);
      setAvailableCalls(callsData);
      setTodayState(stateData.state || 'WORKING');

    } catch (err) {
      console.error('Dashboard load error:', err);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  };

  const startPresencePing = () => {
    stopPresencePing(); // 기존 것 정리
    
    const ping = async () => {
      try {
        const token = await AsyncStorage.getItem("token");
        await fetch(`${API_URL}/presence/ping`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'x-driver-id': user?.id?.toString() // driver_id를 헤더로 전달
          },
          body: JSON.stringify({
            driver_id: user?.id, // body에도 추가
            // 위치 정보가 있다면 추가 가능
            // lat: currentLocation?.latitude,
            // lng: currentLocation?.longitude
          })
        });
      } catch (err) {
        console.error('Presence ping error:', err);
      }
    };

    // 즉시 한번 실행
    ping();
    
    // 30초마다 핑
    pingIntervalRef.current = setInterval(ping, 30000);
  };

  const stopPresencePing = () => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  };

  const handleStateChange = async (newState) => {
    try {
      const token = await AsyncStorage.getItem("token");
      const response = await fetch(`${API_URL}/driver/update-state`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ state: newState })
      });

      if (response.ok) {
        setTodayState(newState);
        Alert.alert("완료", `상태가 "${getStateLabel(newState)}"로 변경되었습니다.`);
      } else {
        Alert.alert("오류", "상태 변경에 실패했습니다.");
      }
    } catch (err) {
      Alert.alert("오류", "네트워크 오류가 발생했습니다.");
    }
  };

  const handleCallResponse = async (callId, accept = true) => {
    try {
      const token = await AsyncStorage.getItem("token");
      const endpoint = accept ? 'accept' : 'decline';
      
      const response = await fetch(`${API_URL}/calls/${callId}/${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        Alert.alert(
          "완료",
          accept ? "긴급 호출에 응답했습니다." : "긴급 호출을 거절했습니다."
        );
        await loadDashboardData(); // 데이터 새로고침
      } else {
        const errorData = await response.text();
        Alert.alert("오류", errorData || "응답 처리에 실패했습니다.");
      }
    } catch (err) {
      Alert.alert("오류", "네트워크 오류가 발생했습니다.");
    }
  };

  const getStateLabel = (state) => {
    switch (state) {
      case 'OFF': return '휴무';
      case 'WORKING': return '근무';
      case 'BLOCKED': return '차단됨';
      default: return '알 수 없음';
    }
  };

  const getStateColor = (state) => {
    switch (state) {
      case 'OFF': return '#ffc107';
      case 'WORKING': return '#28a745';
      case 'BLOCKED': return '#dc3545';
      default: return '#6c757d';
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      "로그아웃",
      "정말 로그아웃 하시겠습니까?",
      [
        { text: "취소", style: "cancel" },
        { 
          text: "로그아웃",
          style: "destructive",
          onPress: async () => {
            await logout();
            navigation.replace("Login");
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={styles.loadingText}>정보 로딩 중...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* 사용자 정보 헤더 */}
      <View style={styles.header}>
        <View style={styles.userInfo}>
          <Text style={styles.welcomeText}>{user?.name}님</Text>
          <Text style={styles.roleText}>반갑습니다!</Text>
        </View>
        <View style={styles.statusContainer}>
          <View style={[
            styles.statusBadge,
            { backgroundColor: getStateColor(todayState) }
          ]}>
            <Text style={styles.statusText}>{getStateLabel(todayState)}</Text>
          </View>
          <View style={styles.onlineContainer}>
            <Text style={styles.onlineLabel}>온라인</Text>
            <Switch
              value={isOnline}
              onValueChange={setIsOnline}
              trackColor={{ false: "#767577", true: "#81b0ff" }}
              thumbColor={isOnline ? "#007bff" : "#f4f3f4"}
            />
          </View>
        </View>
      </View>

      {/* 긴급 호출 알림 */}
      {availableCalls.length > 0 && (
        <View style={styles.urgentSection}>
          <Text style={styles.urgentTitle}>🚨 긴급 호출</Text>
          {availableCalls.map((call) => (
            <View key={call.id} style={styles.callCard}>
              <View style={styles.callHeader}>
                <Text style={styles.callRoute}>{call.route_id}</Text>
                <Text style={styles.callTime}>
                  {call.start_time} - {call.end_time}
                </Text>
              </View>
              <Text style={styles.callDate}>날짜: {call.service_date}</Text>
              <Text style={styles.callExpires}>
                마감: {new Date(call.expires_at).toLocaleTimeString('ko-KR')}
              </Text>
              <View style={styles.callActions}>
                <TouchableOpacity
                  style={[styles.callButton, styles.acceptButton]}
                  onPress={() => handleCallResponse(call.id, true)}
                >
                  <Text style={styles.callButtonText}>수락</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.callButton, styles.declineButton]}
                  onPress={() => handleCallResponse(call.id, false)}
                >
                  <Text style={styles.callButtonText}>거절</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* 내 시프트 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📅 내 시프트</Text>
        {myShifts.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>배정된 시프트가 없습니다</Text>
          </View>
        ) : (
          myShifts.map((shift) => (
            <View key={shift.id} style={styles.shiftCard}>
              <View style={styles.shiftHeader}>
                <Text style={styles.shiftRoute}>{shift.route_id}</Text>
                <Text style={[
                  styles.shiftStatus,
                  { color: shift.status === 'CONFIRMED' ? '#28a745' : '#ffc107' }
                ]}>
                  {shift.status === 'CONFIRMED' ? '확정' : '대기'}
                </Text>
              </View>
              <View style={styles.shiftBody}>
                <Text style={styles.shiftTime}>
                  {shift.start_time} - {shift.end_time}
                </Text>
                <Text style={styles.shiftDate}>{shift.service_date}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* 상태 변경 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>⚙️ 오늘 근무 상태</Text>
        <View style={styles.stateButtons}>
          <TouchableOpacity
            style={[
              styles.stateButton,
              todayState === 'WORKING' && styles.stateButtonActive
            ]}
            onPress={() => handleStateChange('WORKING')}
          >
            <Text style={[
              styles.stateButtonText,
              todayState === 'WORKING' && styles.stateButtonTextActive
            ]}>
              근무 가능
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.stateButton,
              todayState === 'OFF' && styles.stateButtonActive
            ]}
            onPress={() => handleStateChange('OFF')}
          >
            <Text style={[
              styles.stateButtonText,
              todayState === 'OFF' && styles.stateButtonTextActive
            ]}>
              휴무
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 로그아웃 버튼 */}
      <View style={styles.bottomSection}>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>로그아웃</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f8f9fa",
  },
  loadingText: {
    marginTop: 10,
    color: "#666",
  },
  header: {
    backgroundColor: "white",
    padding: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    elevation: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  userInfo: {
    flex: 1,
  },
  welcomeText: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  roleText: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  statusContainer: {
    alignItems: "flex-end",
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 8,
  },
  statusText: {
    color: "white",
    fontSize: 12,
    fontWeight: "bold",
  },
  onlineContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  onlineLabel: {
    fontSize: 12,
    color: "#666",
    marginRight: 8,
  },
  urgentSection: {
    margin: 15,
    backgroundColor: "#fff5f5",
    borderRadius: 10,
    padding: 15,
    borderWidth: 2,
    borderColor: "#dc3545",
  },
  urgentTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#dc3545",
    marginBottom: 10,
  },
  callCard: {
    backgroundColor: "white",
    borderRadius: 8,
    padding: 15,
    marginBottom: 10,
    elevation: 1,
  },
  callHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  callRoute: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  callTime: {
    fontSize: 14,
    color: "#666",
  },
  callDate: {
    fontSize: 12,
    color: "#666",
    marginBottom: 2,
  },
  callExpires: {
    fontSize: 12,
    color: "#dc3545",
    marginBottom: 10,
  },
  callActions: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  callButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: "center",
    marginHorizontal: 5,
  },
  acceptButton: {
    backgroundColor: "#28a745",
  },
  declineButton: {
    backgroundColor: "#6c757d",
  },
  callButtonText: {
    color: "white",
    fontWeight: "bold",
  },
  section: {
    margin: 15,
    backgroundColor: "white",
    borderRadius: 10,
    padding: 15,
    elevation: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 10,
    color: "#333",
  },
  emptyState: {
    padding: 20,
    alignItems: "center",
  },
  emptyText: {
    color: "#666",
    fontSize: 14,
  },
  shiftCard: {
    backgroundColor: "#f8f9fa",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  shiftHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 5,
  },
  shiftRoute: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  shiftStatus: {
    fontSize: 12,
    fontWeight: "bold",
  },
  shiftBody: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  shiftTime: {
    fontSize: 14,
    color: "#666",
  },
  shiftDate: {
    fontSize: 14,
    color: "#666",
  },
  stateButtons: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  stateButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginHorizontal: 5,
    backgroundColor: "#e9ecef",
    borderWidth: 1,
    borderColor: "#dee2e6",
  },
  stateButtonActive: {
    backgroundColor: "#007bff",
    borderColor: "#007bff",
  },
  stateButtonText: {
    fontSize: 14,
    color: "#6c757d",
    fontWeight: "600",
  },
  stateButtonTextActive: {
    color: "white",
  },
  bottomSection: {
    margin: 15,
    marginTop: 30,
  },
  logoutButton: {
    backgroundColor: "#6c757d",
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: "center",
  },
  logoutButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
});