package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"tvapp/internal/db"
)

func getJWTSecret() string {
	secret := db.GetSetting("jwt_secret", "")
	if secret == "" {
		secret = strconv.FormatInt(time.Now().UnixNano(), 16)
		db.SetSetting("jwt_secret", secret)
	}
	return secret
}

type AuthRequest struct {
	ProfileID int    `json:"profile_id"`
	Pin       string `json:"pin"`
}

type AuthResponse struct {
	Token   string `json:"token"`
	IsAdmin bool   `json:"is_admin"`
}

func loginHandler(w http.ResponseWriter, r *http.Request) {
	var req AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	profile, err := db.GetProfile(req.ProfileID)
	if err != nil {
		http.Error(w, "invalid profile", http.StatusUnauthorized)
		return
	}

	if profile.Pin != "" && profile.Pin != req.Pin {
		http.Error(w, "invalid pin", http.StatusUnauthorized)
		return
	}

	token, err := createToken(profile.ID, profile.IsAdmin)
	if err != nil {
		http.Error(w, "failed to generate token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AuthResponse{
		Token:   token,
		IsAdmin: profile.IsAdmin,
	})
}

func createToken(profileID int, isAdmin bool) (string, error) {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	
	claimsBytes, _ := json.Marshal(map[string]interface{}{
		"sub":      profileID,
		"is_admin": isAdmin,
		"exp":      time.Now().AddDate(1, 0, 0).Unix(),
	})
	claims := base64.RawURLEncoding.EncodeToString(claimsBytes)

	signature := signJWT(header + "." + claims)
	return header + "." + claims + "." + signature, nil
}

func signJWT(data string) string {
	h := hmac.New(sha256.New, []byte(getJWTSecret()))
	h.Write([]byte(data))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

func verifyToken(token string) (int, bool, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return 0, false, errors.New("invalid token format")
	}

	if signJWT(parts[0]+"."+parts[1]) != parts[2] {
		return 0, false, errors.New("invalid signature")
	}

	claimsBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return 0, false, err
	}

	var claims struct {
		Sub     int   `json:"sub"`
		IsAdmin bool  `json:"is_admin"`
		Exp     int64 `json:"exp"`
	}
	if err := json.Unmarshal(claimsBytes, &claims); err != nil {
		return 0, false, err
	}

	if time.Now().Unix() > claims.Exp {
		return 0, false, errors.New("token expired")
	}

	return claims.Sub, claims.IsAdmin, nil
}

func getProfileFromRequest(r *http.Request) (int, bool) {
	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return 0, false
	}
	token := strings.TrimPrefix(authHeader, "Bearer ")
	profileID, isAdmin, err := verifyToken(token)
	if err != nil {
		return 0, false
	}
	return profileID, isAdmin
}

func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		profileID, _ := getProfileFromRequest(r)
		if profileID == 0 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		
		r.Header.Set("X-Profile-ID", strconv.Itoa(profileID))
		next.ServeHTTP(w, r)
	})
}

func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		profileID, isAdmin := getProfileFromRequest(r)
		if profileID == 0 || !isAdmin {
			http.Error(w, "forbidden: admins only", http.StatusForbidden)
			return
		}
		
		r.Header.Set("X-Profile-ID", strconv.Itoa(profileID))
		next.ServeHTTP(w, r)
	})
}
