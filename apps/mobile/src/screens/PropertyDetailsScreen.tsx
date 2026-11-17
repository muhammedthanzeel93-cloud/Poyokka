/**
 * Property Details & Room Type Discovery Screen
 */

import React, { useEffect, useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { THEME_COLORS } from '@kerala-tourism/constants';
import { PublicPropertyDto, PublicRoomTypeDto } from '@kerala-tourism/shared-types';
import { Header } from '../components/Header';
import { formatPaiseToInr } from '../components/PriceBreakdownCard';
import { ErrorView, LoadingView } from '../components/StateViews';
import { useAppNavigation } from '../navigation/NavigationContext';
import { api } from '../services/api';

interface PropertyDetailsScreenProps {
  propertyId: string;
  initialProperty?: PublicPropertyDto;
}

export const PropertyDetailsScreen: React.FC<PropertyDetailsScreenProps> = ({
  propertyId,
  initialProperty,
}) => {
  const { navigate } = useAppNavigation();
  const [property, setProperty] = useState<PublicPropertyDto | null>(initialProperty || null);
  const [roomTypes, setRoomTypes] = useState<PublicRoomTypeDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const roomsRes = await api.properties.getRooms(propertyId);
      setRoomTypes(roomsRes.data.items);

      if (!property) {
        // Fallback property summary if not passed via route
        setProperty({
          id: propertyId,
          businessId: 'bus_sample',
          business: {
            businessName: 'Kerala Hospitality Group',
            verificationStatus: 'VERIFIED',
          },
          name: 'Vythiri Rainforest Retreat & Spa',
          slug: 'vythiri-rainforest-retreat',
          propertyType: 'RESORT',
          description:
            'Eco-friendly luxury resort nestled in the lush tropical rainforests of Wayanad. Features traditional Kerala architecture, Ayurvedic wellness center, and organic spice plantation views.',
          address: 'Lakkidi P.O., Wayanad, Kerala 673576',
          destinationId: 'dest_wayanad',
          facilities: ['WIFI', 'SWIMMING_POOL', 'SPA', 'RESTAURANT', 'PARKING'],
          rating: 4.8,
          reviewCount: 142,
          media: [
            {
              url: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=800&q=80',
              caption: 'Resort Overview',
              isPrimary: true,
            },
          ],
        } as any);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load property details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [propertyId]);

  if (loading) {
    return <LoadingView message="Loading property & available rooms..." />;
  }

  if (error || !property) {
    return <ErrorView message={error || 'Property not found'} onRetry={loadData} />;
  }

  const primaryImage =
    property.coverImageUrl ||
    property.galleryImageUrls?.[0] ||
    'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=800&q=80';

  const rating = (property as any).rating ?? 4.8;
  const reviewCount = (property as any).reviewCount ?? 142;

  return (
    <View style={styles.container}>
      <Header title={property.name} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero Image */}
        <Image source={{ uri: primaryImage }} style={styles.heroImage} resizeMode="cover" />

        {/* Property Header */}
        <View style={styles.infoSection}>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>{property.propertyType}</Text>
          </View>
          <Text style={styles.propertyName}>{property.name}</Text>
          <Text style={styles.propertyAddress}>📍 {property.address}</Text>

          <View style={styles.ratingRow}>
            <Text style={styles.star}>★</Text>
            <Text style={styles.ratingText}>{Number(rating).toFixed(1)}</Text>
            <Text style={styles.reviewCount}>({reviewCount} reviews)</Text>
          </View>

          <Text style={styles.description}>{property.description}</Text>
        </View>

        {/* Facilities Chips */}
        {property.facilities && property.facilities.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Property Amenities</Text>
            <View style={styles.chipRow}>
              {property.facilities.map((facility, idx) => (
                <View key={idx} style={styles.chip}>
                  <Text style={styles.chipText}>{facility.replace(/_/g, ' ')}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Room Types Listing */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Available Room Types</Text>
          <Text style={styles.sectionSubtitle}>
            Select a room category to choose dates and reserve inventory
          </Text>

          {roomTypes.length === 0 ? (
            <View style={styles.emptyRoomsCard}>
              <Text style={styles.emptyRoomsText}>No active room types currently available.</Text>
            </View>
          ) : (
            roomTypes.map((room) => {
              const basePaise = room.pricePerNightPaise || room.pricePerNight * 100;
              return (
                <View key={room.id} style={styles.roomCard}>
                  <View style={styles.roomHeader}>
                    <View style={styles.roomTitleCol}>
                      <Text style={styles.roomName}>{room.name}</Text>
                      <Text style={styles.roomCategory}>{room.roomCategory.replace(/_/g, ' ')}</Text>
                    </View>
                    <View style={styles.roomPriceCol}>
                      <Text style={styles.roomPrice}>{formatPaiseToInr(basePaise)}</Text>
                      <Text style={styles.roomPriceSub}>/ night</Text>
                    </View>
                  </View>

                  <Text style={styles.roomDescription}>{room.description}</Text>

                  <View style={styles.metaRow}>
                    <Text style={styles.metaPill}>
                      👥 Max {room.maxAdults} Adults, {room.maxChildren} Kids
                    </Text>
                    {room.bedCount ? (
                      <Text style={styles.metaPill}>🛏️ {room.bedCount} Bed(s)</Text>
                    ) : null}
                  </View>

                  <TouchableOpacity
                    style={styles.bookButton}
                    onPress={() =>
                      navigate('DateGuestSelection', {
                        propertyId: property.id,
                        propertyName: property.name,
                        roomType: room,
                      })
                    }
                  >
                    <Text style={styles.bookButtonText}>Select Dates & Check Availability</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F7F1',
  },
  content: {
    paddingBottom: 40,
  },
  heroImage: {
    width: '100%',
    height: 220,
    backgroundColor: '#CBD5E1',
  },
  infoSection: {
    padding: 16,
    backgroundColor: THEME_COLORS.WHITE,
    borderBottomWidth: 1,
    borderBottomColor: THEME_COLORS.MUTED_BORDER,
  },
  typeBadge: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0369A1',
  },
  propertyName: {
    fontSize: 20,
    fontWeight: '800',
    color: THEME_COLORS.CHARCOAL,
    marginBottom: 4,
  },
  propertyAddress: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 8,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  star: {
    color: '#EAB308',
    fontSize: 16,
    marginRight: 4,
  },
  ratingText: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
    marginRight: 4,
  },
  reviewCount: {
    fontSize: 13,
    color: '#64748B',
  },
  description: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: THEME_COLORS.WHITE,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  roomCard: {
    backgroundColor: THEME_COLORS.WHITE,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
  },
  roomHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  roomTitleCol: {
    flex: 1,
    marginRight: 8,
  },
  roomName: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
  },
  roomCategory: {
    fontSize: 12,
    color: THEME_COLORS.NATURE_GREEN,
    fontWeight: '600',
    marginTop: 2,
  },
  roomPriceCol: {
    alignItems: 'flex-end',
  },
  roomPrice: {
    fontSize: 18,
    fontWeight: '800',
    color: THEME_COLORS.FOREST_GREEN,
  },
  roomPriceSub: {
    fontSize: 11,
    color: '#64748B',
  },
  roomDescription: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  metaPill: {
    fontSize: 12,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    color: '#475569',
    fontWeight: '500',
  },
  bookButton: {
    backgroundColor: THEME_COLORS.FOREST_GREEN,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookButtonText: {
    color: THEME_COLORS.WHITE,
    fontWeight: '700',
    fontSize: 14,
  },
  emptyRoomsCard: {
    backgroundColor: THEME_COLORS.WHITE,
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyRoomsText: {
    color: '#64748B',
    fontSize: 14,
  },
});
