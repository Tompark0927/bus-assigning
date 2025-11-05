import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL } from "../api/auth";

export default function AdminScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  
  // 대시보드 데이터
  const [dashboardData, setDashboardData] = useState({
    todayShifts: [],
    openCalls: [],
    activeDrivers: 0,
    totalShifts: 0,
    confirmedShifts: 0,
  });

  const [selectedTab, setSelectedTab] = useState("dashboard"); // dashboard, calls, drivers, schedule

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setError(null);
      const token = await AsyncStorage.getItem("token");
      
      if (!token) {
        navigation.replace("Login");
        return;
      }

      const headers = { 
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      };

      // 병렬로 여러 API 호출
      const [todayRes, callsRes, overviewRes] = await Promise.all([
        fetch(`${API_URL}/admin/today-shifts`, { headers }),
        fetch(`${API_URL}/admin/open-calls`, { headers }),
        fetch(`${API_URL}/admin/dashboard-overview`, { headers })
      ]);

      const todayShifts = todayRes.ok ? await todayRes.json() : [];
      const openCalls = callsRes.ok ? await callsRes.json() : [];
      const overview = overviewRes.ok ? await overviewRes.json() : {};

      setDashboardData({
        todayShifts: todayShifts || [],
        openCalls: openCalls || [],
        activeDrivers: overview.activeDrivers || 0,
        totalShifts: overview.totalShifts || 0,
        confirmedShifts: overview.confirmedShifts || 0,
      });

    } catch (err) {
      console.error("Dashboard fetch error", err);
      setError("데이터 불러오기 실패");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchDashboardData();
  };

  const handleCreateEmergencyCall = async (shiftId) => {
    Alert.alert(
      "긴급 호출 생성",
      "이 시프트에 대한 긴급 호출을 생성하시겠습니까?",
      [
        { text: "취소", style: "cancel" },
        {
          text: "생성",
          onPress: async () => {
            try {
              const token = await AsyncStorage.getItem("token");
              const response = await fetch(`${API_URL}/admin/create-call`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ shiftId })
              });

              if (response.ok) {
                Alert.alert("성공", "긴급 호출이 생성되었습니다.");
                fetchDashboardData(); // 데이터 새로고침
              } else {
                Alert.alert("오류", "긴급 호출 생성에 실패했습니다.");
              }
            } catch (error) {
              Alert.alert("오류", "네트워크 오류가 발생했습니다.");
            }
          }
        }
      ]
    );
  };

  const handleCancelAssignment = async (assignmentId) => {
    Alert.alert(
      "배정 취소",
      "이 배정을 취소하고 긴급 호출을 생성하시겠습니까?",
      [
        { text: "취소", style: "cancel" },
        {
          text: "취소 및 호출 생성",
          style: "destructive",
          onPress: async () => {
            try {
              const token = await AsyncStorage.getItem("token");
              const response = await fetch(`${API_URL}/assignments/${assignmentId}/cancel`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json'
                }
              });

              if (response.ok) {
                Alert.alert("성공", "배정이 취소되고 긴급 호출이 생성되었습니다.");
                fetchDashboardData();
              } else {
                Alert.alert("오류", "배정 취소에 실패했습니다.");
              }
            } catch (error) {
              Alert.alert("오류", "네트워크 오류가 발생했습니다.");
            }
          }
        }
      ]
    );
  };

  const renderDashboard = () => (
    <ScrollView style={styles.container}>
      {/* 통계 카드들 */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{dashboardData.totalShifts}</Text>
          <Text style={styles.statLabel}>오늘 총 시프트</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNumber, { color: '#28a745' }]}>{dashboardData.confirmedShifts}</Text>
          <Text style={styles.statLabel}>확정된 시프트</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNumber, { color: '#dc3545' }]}>{dashboardData.openCalls.length}</Text>
          <Text style={styles.statLabel}>진행 중인 호출</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNumber, { color: '#17a2b8' }]}>{dashboardData.activeDrivers}</Text>
          <Text style={styles.statLabel}>활성 기사</Text>
        </View>
      </View>

      {/* 진행 중인 긴급 호출 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🚨 진행 중인 긴급 호출</Text>
        {dashboardData.openCalls.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>진행 중인 긴급 호출이 없습니다</Text>
          </View>
        ) : (
          <FlatList
            data={dashboardData.openCalls}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => (
              <View style={styles.callCard}>
                <View style={styles.callHeader}>
                  <Text style={styles.callRoute}>{item.route_id}</Text>
                  <Text style={styles.callTime}>{item.start_time} - {item.end_time}</Text>
                </View>
                <Text style={styles.callDate}>날짜: {item.service_date}</Text>
                <Text style={styles.callExpires}>
                  만료: {new Date(item.expires_at).toLocaleString('ko-KR')}
                </Text>
                <Text style={styles.callResponses}>응답: {item.response_count || 0}명</Text>
              </View>
            )}
          />
        )}
      </View>

      {/* 오늘의 시프트 목록 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📋 오늘의 시프트</Text>
        <FlatList
          data={dashboardData.todayShifts}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <View style={styles.shiftCard}>
              <View style={styles.shiftHeader}>
                <Text style={styles.shiftRoute}>{item.route_id}</Text>
                <Text style={styles.shiftTime}>{item.start_time} - {item.end_time}</Text>
              </View>
              <View style={styles.shiftBody}>
                <Text style={styles.shiftDriver}>
                  기사: {item.driver_name || "미배정"}
                </Text>
                <Text style={[
                  styles.shiftStatus,
                  { color: item.status === 'CONFIRMED' ? '#28a745' : '#ffc107' }
                ]}>
                  {item.status === 'CONFIRMED' ? '확정' : '대기'}
                </Text>
              </View>
              <View style={styles.shiftActions}>
                {item.assignment_id && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.cancelButton]}
                    onPress={() => handleCancelAssignment(item.assignment_id)}
                  >
                    <Text style={styles.actionButtonText}>배정 취소</Text>
                  </TouchableOpacity>
                )}
                {!item.assignment_id && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.callButton]}
                    onPress={() => handleCreateEmergencyCall(item.id)}
                  >
                    <Text style={styles.actionButtonText}>긴급 호출</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>오늘 시프트가 없습니다</Text>
            </View>
          }
        />
      </View>
    </ScrollView>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={styles.loadingText}>데이터 로딩 중...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchDashboardData}>
          <Text style={styles.retryButtonText}>다시 시도</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 탭 네비게이션 */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, selectedTab === "dashboard" && styles.activeTab]}
          onPress={() => setSelectedTab("dashboard")}
        >
          <Text style={[styles.tabText, selectedTab === "dashboard" && styles.activeTabText]}>
            대시보드
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, selectedTab === "calls" && styles.activeTab]}
          onPress={() => setSelectedTab("calls")}
        >
          <Text style={[styles.tabText, selectedTab === "calls" && styles.activeTabText]}>
            호출 관리
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, selectedTab === "drivers" && styles.activeTab]}
          onPress={() => setSelectedTab("drivers")}
        >
          <Text style={[styles.tabText, selectedTab === "drivers" && styles.activeTabText]}>
            기사 관리
          </Text>
        </TouchableOpacity>
      </View>

      {/* 컨텐츠 */}
      <View style={styles.content}>
        {selectedTab === "dashboard" && renderDashboard()}
        {selectedTab === "calls" && (
          <View style={styles.comingSoon}>
            <Text style={styles.comingSoonText}>호출 관리 기능 준비 중...</Text>
          </View>
        )}
        {selectedTab === "drivers" && (
          <View style={styles.comingSoon}>
            <Text style={styles.comingSoonText}>기사 관리 기능 준비 중...</Text>
          </View>
        )}
      </View>

      {/* 로그아웃 버튼 */}
      <View style={styles.bottomActions}>
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={async () => {
            await AsyncStorage.removeItem("token");
            await AsyncStorage.removeItem("driver");
            navigation.replace("Login");
          }}
        >
          <Text style={styles.logoutButtonText}>로그아웃</Text>
        </TouchableOpacity>
      </View>
    </View>
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
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    color: "#dc3545",
    textAlign: "center",
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: "#007bff",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 5,
  },
  retryButtonText: {
    color: "white",
    fontWeight: "bold",
  },
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "white",
    elevation: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 15,
    alignItems: "center",
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
  },
  activeTab: {
    borderBottomColor: "#007bff",
  },
  tabText: {
    fontSize: 16,
    color: "#666",
  },
  activeTabText: {
    color: "#007bff",
    fontWeight: "bold",
  },
  content: {
    flex: 1,
  },
  statsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 15,
    justifyContent: "space-between",
  },
  statCard: {
    backgroundColor: "white",
    borderRadius: 8,
    padding: 15,
    width: "48%",
    marginBottom: 10,
    alignItems: "center",
    elevation: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
  statLabel: {
    fontSize: 12,
    color: "#666",
    marginTop: 5,
    textAlign: "center",
  },
  section: {
    paddingHorizontal: 15,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 10,
    color: "#333",
  },
  emptyState: {
    backgroundColor: "white",
    borderRadius: 8,
    padding: 20,
    alignItems: "center",
  },
  emptyText: {
    color: "#666",
    fontSize: 14,
  },
  callCard: {
    backgroundColor: "#fff5f5",
    borderRadius: 8,
    padding: 15,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: "#dc3545",
  },
  callHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  callRoute: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#dc3545",
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
    marginBottom: 2,
  },
  callResponses: {
    fontSize: 12,
    color: "#28a745",
  },
  shiftCard: {
    backgroundColor: "white",
    borderRadius: 8,
    padding: 15,
    marginBottom: 10,
    elevation: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  shiftHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  shiftRoute: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  shiftTime: {
    fontSize: 14,
    color: "#666",
  },
  shiftBody: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  shiftDriver: {
    fontSize: 14,
    color: "#333",
  },
  shiftStatus: {
    fontSize: 12,
    fontWeight: "bold",
  },
  shiftActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  actionButton: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 5,
    marginLeft: 5,
  },
  cancelButton: {
    backgroundColor: "#dc3545",
  },
  callButton: {
    backgroundColor: "#ffc107",
  },
  actionButtonText: {
    color: "white",
    fontSize: 12,
    fontWeight: "bold",
  },
  comingSoon: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  comingSoonText: {
    color: "#666",
    fontSize: 16,
  },
  bottomActions: {
    padding: 15,
    backgroundColor: "white",
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  logoutButton: {
    backgroundColor: "#6c757d",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
  },
  logoutButtonText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
});